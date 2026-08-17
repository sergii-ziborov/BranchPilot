use std::fs::Metadata;
use std::path::Path;
use std::time::UNIX_EPOCH;

use weavatrix_git::{IndexEntry, ObjectKind, Repository};

use crate::attributes::{Attributes, Conversion};
use crate::error::{CoreError, Result};
use crate::git_config::GitConfig;

const MODE_KIND_MASK: u32 = 0o170_000;
const MODE_KIND_FILE: u32 = 0o100_000;
const MODE_KIND_SYMLINK: u32 = 0o120_000;
const MODE_KIND_GITLINK: u32 = 0o160_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorktreeState {
    Unmodified,
    Modified,
    Deleted,
    TypeChanged,
}

/// How this checkout converts content, from `core.autocrlf` and
/// `.gitattributes` together.
///
/// Git stores text blobs with LF and may write CRLF into the worktree, so a
/// byte-for-byte comparison against the blob reports every text file as
/// modified on a Windows checkout. This carries the rule that makes the
/// comparison meaningful.
#[derive(Debug)]
pub struct ContentPolicy {
    attributes: Attributes,
    autocrlf_normalizes: bool,
}

impl ContentPolicy {
    #[must_use]
    pub fn detect(config: &GitConfig, work_dir: &Path) -> Self {
        let autocrlf = config.get("core.autocrlf").unwrap_or("false");

        Self {
            attributes: Attributes::load(work_dir),
            // Both `true` and `input` normalize on the worktree → object side.
            autocrlf_normalizes: matches!(autocrlf, "true" | "input"),
        }
    }

    /// Tell the policy that tracked per-directory attribute files exist.
    pub fn set_nested_attributes(&mut self, nested: bool) {
        self.attributes.set_nested(nested);
    }

    fn conversion(&self, path: &str) -> Result<Conversion> {
        if self.attributes.nested() {
            return Err(CoreError::Unsupported("nested-gitattributes".to_owned()));
        }

        match self.attributes.conversion(path, self.autocrlf_normalizes) {
            Conversion::Filtered => Err(CoreError::Unsupported("clean-filter".to_owned())),
            conversion => Ok(conversion),
        }
    }
}

/// Compare one tracked path against its index entry, the way Git does.
///
/// The stat fast path (`size` and `mtime` still matching what the index
/// recorded) answers for every unchanged file without reading it — which is
/// both what makes status fast and what keeps it correct under content filters,
/// because the index caches the *worktree* size, not the blob size.
pub fn compare(
    repository: &Repository,
    work_dir: &Path,
    path: &str,
    entry: &IndexEntry,
    policy: &ContentPolicy,
) -> Result<WorktreeState> {
    if entry.skip_worktree || entry.intent_to_add || entry.assume_valid {
        return Ok(WorktreeState::Unmodified);
    }

    let absolute = work_dir.join(path);

    let metadata = match std::fs::symlink_metadata(&absolute) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorktreeState::Deleted);
        }
        Err(error) => return Err(error.into()),
    };

    match entry.mode & MODE_KIND_MASK {
        MODE_KIND_FILE if metadata.is_file() => {
            compare_file(repository, &absolute, path, &metadata, entry, policy)
        }
        MODE_KIND_SYMLINK if metadata.file_type().is_symlink() => {
            compare_symlink(repository, &absolute, entry)
        }
        MODE_KIND_GITLINK => Err(CoreError::Unsupported("submodule-worktree".to_owned())),
        _ => Ok(WorktreeState::TypeChanged),
    }
}

fn compare_file(
    repository: &Repository,
    absolute: &Path,
    path: &str,
    metadata: &Metadata,
    entry: &IndexEntry,
    policy: &ContentPolicy,
) -> Result<WorktreeState> {
    if stat_matches(metadata, entry) {
        return Ok(WorktreeState::Unmodified);
    }

    // Only paths that actually look changed need content — and only those are
    // affected by conversion rules.
    let conversion = policy.conversion(path)?;
    let content = std::fs::read(absolute)?;

    compare_bytes(repository, &content, entry, conversion)
}

fn compare_symlink(
    repository: &Repository,
    absolute: &Path,
    entry: &IndexEntry,
) -> Result<WorktreeState> {
    let target = std::fs::read_link(absolute)?;
    let target = target
        .to_str()
        .ok_or_else(|| CoreError::Unsupported("non-utf8-symlink".to_owned()))?;

    compare_bytes(repository, target.as_bytes(), entry, Conversion::Raw)
}

fn compare_bytes(
    repository: &Repository,
    content: &[u8],
    entry: &IndexEntry,
    conversion: Conversion,
) -> Result<WorktreeState> {
    let object = repository.object(entry.id)?;

    if object.kind != ObjectKind::Blob {
        return Err(CoreError::Unsupported("index-entry-not-blob".to_owned()));
    }

    if content == object.data.as_slice() {
        return Ok(WorktreeState::Unmodified);
    }

    if conversion == Conversion::CrlfToLf
        && !is_binary(content)
        && normalize_crlf(content) == object.data
    {
        return Ok(WorktreeState::Unmodified);
    }

    Ok(WorktreeState::Modified)
}

/// Git treats an entry as clean when the cached stat data still matches.
fn stat_matches(metadata: &Metadata, entry: &IndexEntry) -> bool {
    let Ok(size) = u32::try_from(metadata.len()) else {
        // The index truncates size to 32 bits, so huge files have no fast path.
        return false;
    };

    // A zero size is also what the index records for an entry whose stat data
    // was never refreshed, so it proves nothing.
    if size != entry.size || entry.size == 0 {
        return false;
    }

    mtime_seconds(metadata).is_some_and(|mtime| mtime == entry.mtime_seconds)
}

fn mtime_seconds(metadata: &Metadata) -> Option<u32> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u32::try_from(duration.as_secs()).ok())
}

/// Git's own rule: a NUL byte early in the file means "do not convert".
fn is_binary(content: &[u8]) -> bool {
    const PROBE_BYTES: usize = 8_000;

    content[..content.len().min(PROBE_BYTES)].contains(&0)
}

/// Drop the CR of every CRLF pair, leaving lone CRs untouched — the same
/// conversion Git applies when staging a text file.
fn normalize_crlf(content: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(content.len());
    let mut index = 0;

    while index < content.len() {
        if content[index] == b'\r' && content.get(index + 1) == Some(&b'\n') {
            index += 1;
            continue;
        }

        result.push(content[index]);
        index += 1;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::{is_binary, normalize_crlf};

    #[test]
    fn strips_only_carriage_returns_before_newlines() {
        assert_eq!(normalize_crlf(b"a\r\nb\r\n"), b"a\nb\n");
        assert_eq!(normalize_crlf(b"a\rb"), b"a\rb");
        assert_eq!(normalize_crlf(b"a\n"), b"a\n");
    }

    #[test]
    fn detects_binary_content_by_nul_byte() {
        assert!(is_binary(b"png\0data"));
        assert!(!is_binary(b"plain text\r\n"));
    }
}
