use std::collections::BTreeMap;

use weavatrix_git::{EntryKind, ObjectId, Repository};

use crate::error::{CoreError, Result};

/// One file recorded in the commit a branch points at.
#[derive(Debug, Clone, Copy)]
pub struct HeadEntry {
    pub mode: u32,
    pub id: ObjectId,
}

pub type HeadEntries = BTreeMap<String, HeadEntry>;

/// Flatten a commit's tree into path → (mode, object id).
///
/// This is the "what the branch says" half of a status: comparing it with the
/// index yields staged changes without touching the worktree.
pub fn entries(repository: &Repository, commit: ObjectId) -> Result<HeadEntries> {
    let root = repository.commit(commit)?.tree;
    let mut pending = vec![(String::new(), root)];
    let mut result = HeadEntries::new();

    while let Some((prefix, tree)) = pending.pop() {
        for entry in repository.tree(tree)?.entries {
            let name = std::str::from_utf8(&entry.name)
                .map_err(|_| CoreError::Unsupported("non-utf8-path".to_owned()))?;
            let path = if prefix.is_empty() {
                name.to_owned()
            } else {
                format!("{prefix}/{name}")
            };

            if entry.kind == EntryKind::Tree {
                pending.push((path, entry.id));
                continue;
            }

            result.insert(
                path,
                HeadEntry {
                    mode: entry.mode,
                    id: entry.id,
                },
            );
        }
    }

    Ok(result)
}
