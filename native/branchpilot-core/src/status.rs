use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

use serde::Serialize;
use weavatrix_git::{IndexEntry, ObjectId, Repository};

use crate::error::{CoreError, Result};
use crate::git_config::GitConfig;
use crate::head_tree::{self, HeadEntries, HeadEntry};
use crate::untracked;
use crate::worktree::{self, ContentPolicy, WorktreeState};

/// Upper bound on an ahead/behind walk. Far beyond any real divergence, but it
/// keeps a corrupt or pathological history from pinning the sidecar.
const MAX_DIVERGENCE_COMMITS: usize = 100_000;

const MODE_KIND_MASK: u32 = 0o170_000;

/// One changed path in Git's porcelain-v2 vocabulary, so the Electron side maps
/// it with the same code that maps `git status` output.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    /// `.` `A` `M` `D` `T` `R` `U`
    pub staged: &'static str,
    /// `.` `M` `D` `T` `U` `?`
    pub unstaged: &'static str,
    pub untracked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_oid: Option<String>,
    pub branch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub is_detached: bool,
    pub entries: Vec<StatusEntry>,
}

/// Full working-tree status without spawning Git.
pub fn status(repository: &Repository, root: &Path) -> Result<StatusPayload> {
    let work_dir = repository
        .work_dir()
        .ok_or_else(|| CoreError::Unsupported("bare-repository".to_owned()))?
        .to_path_buf();

    let head = repository.head()?;
    let is_detached = head.symbolic.is_none();
    let branch = head
        .symbolic
        .as_deref()
        .map(short_branch_name)
        .unwrap_or_default()
        .to_owned();

    let config = GitConfig::load(&repository.common_dir().join("config"));
    let policy = ContentPolicy::detect(&config, &work_dir);

    let head_entries = match head.target {
        Some(commit) => head_tree::entries(repository, commit)?,
        None => HeadEntries::new(),
    };

    let changes = collect_changes(repository, &work_dir, head_entries, policy)?;
    let mut entries = changes.entries;

    for path in untracked::untracked_paths(root, &changes.tracked)? {
        entries.push(StatusEntry {
            path,
            original_path: None,
            staged: ".",
            unstaged: "?",
            untracked: true,
        });
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));

    let upstream = config.upstream(&branch);
    let (ahead, behind) = divergence(repository, head.target, upstream.as_deref())?;

    Ok(StatusPayload {
        head_oid: head.target.map(|id| id.to_string()),
        branch,
        upstream,
        ahead,
        behind,
        is_detached,
        entries,
    })
}

struct Changes {
    entries: Vec<StatusEntry>,
    tracked: BTreeSet<String>,
}

/// Compare index against HEAD (staged) and against the worktree (unstaged).
fn collect_changes(
    repository: &Repository,
    work_dir: &Path,
    mut head_entries: HeadEntries,
    mut policy: ContentPolicy,
) -> Result<Changes> {
    let index = repository.index_shared()?;

    // Per-directory attribute files change how content compares, and this build
    // reads only the top-level one.
    policy.set_nested_attributes(
        index
            .entries()
            .iter()
            .any(|entry| entry.path.ends_with(b"/.gitattributes")),
    );

    let mut entries = Vec::new();
    let mut tracked = BTreeSet::new();
    let mut unmerged = BTreeSet::new();
    let mut index_ids = BTreeMap::new();
    let mut added = Vec::new();

    for entry in index.entries() {
        let path = decode_path(&entry.path)?;
        tracked.insert(path.clone());

        if entry.stage > 0 {
            // Stages 1..3 describe the same conflicted path; report it once.
            if unmerged.insert(path.clone()) {
                head_entries.remove(&path);
                entries.push(StatusEntry {
                    path,
                    original_path: None,
                    staged: "U",
                    unstaged: "U",
                    untracked: false,
                });
            }
            continue;
        }

        index_ids.insert(path.clone(), entry.id);

        let staged = staged_kind(entry, head_entries.remove(&path));
        let unstaged = worktree::compare(repository, work_dir, &path, entry, &policy)?;

        if staged == "A" && unstaged == WorktreeState::Unmodified {
            added.push(path.clone());
        }

        if staged == "." && unstaged == WorktreeState::Unmodified {
            continue;
        }

        entries.push(StatusEntry {
            path,
            original_path: None,
            staged,
            unstaged: worktree_code(unstaged),
            untracked: false,
        });
    }

    // Whatever HEAD still holds was removed from the index: a staged deletion.
    let deleted: Vec<String> = head_entries.keys().cloned().collect();

    for path in &deleted {
        entries.push(StatusEntry {
            path: path.clone(),
            original_path: None,
            staged: "D",
            unstaged: ".",
            untracked: false,
        });
    }

    if !added.is_empty() && !deleted.is_empty() {
        entries = apply_renames(&head_entries_by_id(&head_entries), &index_ids, &added, &deleted, entries)?;
    }

    Ok(Changes { entries, tracked })
}

fn head_entries_by_id(head_entries: &HeadEntries) -> HashMap<ObjectId, Vec<String>> {
    let mut by_id: HashMap<ObjectId, Vec<String>> = HashMap::new();

    for (path, entry) in head_entries {
        by_id.entry(entry.id).or_default().push(path.clone());
    }

    by_id
}

/// Pair staged additions with staged deletions carrying the same object id.
///
/// Git also pairs *similar* content, which needs the line-level scoring the diff
/// engine owns. Until that lands, an unpaired add/delete makes the whole read
/// `unsupported` so the caller falls back to the console backend rather than
/// showing a rename as an unrelated add plus delete.
fn apply_renames(
    deleted_by_id: &HashMap<ObjectId, Vec<String>>,
    index_ids: &BTreeMap<String, ObjectId>,
    added: &[String],
    deleted: &[String],
    entries: Vec<StatusEntry>,
) -> Result<Vec<StatusEntry>> {
    let mut renames = HashMap::new();
    let mut sources = BTreeSet::new();

    for path in added {
        let Some(id) = index_ids.get(path) else {
            continue;
        };
        let Some(candidates) = deleted_by_id.get(id) else {
            continue;
        };
        // Ambiguous pairing (identical content under several old paths) is not a
        // fact we can prove; leave it to the console backend.
        let [source] = candidates.as_slice() else {
            continue;
        };

        renames.insert(path.clone(), source.clone());
        sources.insert(source.clone());
    }

    if renames.len() != added.len() || sources.len() != deleted.len() {
        return Err(CoreError::Unsupported("possible-rename".to_owned()));
    }

    let mut result = Vec::with_capacity(entries.len() - renames.len());

    for mut entry in entries {
        if sources.contains(&entry.path) {
            continue;
        }

        if let Some(original) = renames.get(&entry.path) {
            entry.staged = "R";
            entry.original_path = Some(original.clone());
        }

        result.push(entry);
    }

    Ok(result)
}

fn staged_kind(entry: &IndexEntry, head: Option<HeadEntry>) -> &'static str {
    let Some(head) = head else {
        return "A";
    };

    if head.mode & MODE_KIND_MASK != entry.mode & MODE_KIND_MASK {
        return "T";
    }

    if head.id != entry.id || head.mode != entry.mode {
        return "M";
    }

    "."
}

const fn worktree_code(state: WorktreeState) -> &'static str {
    match state {
        WorktreeState::Unmodified => ".",
        WorktreeState::Modified => "M",
        WorktreeState::Deleted => "D",
        WorktreeState::TypeChanged => "T",
    }
}

/// Commits the local branch has that its upstream lacks, and the reverse.
fn divergence(
    repository: &Repository,
    local: Option<ObjectId>,
    upstream: Option<&str>,
) -> Result<(u32, u32)> {
    let (Some(local), Some(upstream)) = (local, upstream) else {
        return Ok((0, 0));
    };

    let Some(remote) = resolve_upstream(repository, upstream) else {
        return Ok((0, 0));
    };

    Ok((
        count_reachable(repository, local, remote)?,
        count_reachable(repository, remote, local)?,
    ))
}

fn resolve_upstream(repository: &Repository, upstream: &str) -> Option<ObjectId> {
    repository
        .resolve(&format!("refs/remotes/{upstream}"))
        .or_else(|_| repository.resolve(&format!("refs/heads/{upstream}")))
        .ok()
}

fn count_reachable(repository: &Repository, from: ObjectId, hide: ObjectId) -> Result<u32> {
    let mut walk = repository.revwalk();
    walk.push(from)?;
    walk.hide(hide)?;

    let mut count = 0_u32;

    for id in (&mut walk).take(MAX_DIVERGENCE_COMMITS) {
        id?;
        count += 1;
    }

    Ok(count)
}

fn short_branch_name(symbolic: &str) -> &str {
    symbolic.strip_prefix("refs/heads/").unwrap_or(symbolic)
}

/// Git allows arbitrary bytes in paths; the renderer's contract is UTF-8. A path
/// we cannot represent exactly defers to the console backend.
fn decode_path(path: &[u8]) -> Result<String> {
    std::str::from_utf8(path)
        .map(str::to_owned)
        .map_err(|_| CoreError::Unsupported("non-utf8-path".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::{WorktreeState, short_branch_name, worktree_code};

    #[test]
    fn maps_worktree_states_to_porcelain_codes() {
        assert_eq!(worktree_code(WorktreeState::Unmodified), ".");
        assert_eq!(worktree_code(WorktreeState::Modified), "M");
        assert_eq!(worktree_code(WorktreeState::Deleted), "D");
        assert_eq!(worktree_code(WorktreeState::TypeChanged), "T");
    }

    #[test]
    fn shortens_head_symbolic_ref() {
        assert_eq!(short_branch_name("refs/heads/main"), "main");
        assert_eq!(short_branch_name("refs/heads/feat/x"), "feat/x");
    }
}
