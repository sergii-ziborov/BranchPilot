use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use weavatrix_git::Repository;

use crate::error::Result;

/// Keeps opened repositories warm across requests.
///
/// weavatrix-git shares object stores, commit-graph acceleration and index
/// snapshots per `Repository`, so reopening on every call throws away exactly
/// the caches that make native reads fast. Any write goes through
/// [`RepositoryCache::invalidate`] so a stale object store is never read.
#[derive(Default)]
pub struct RepositoryCache {
    open: HashMap<PathBuf, Arc<Repository>>,
}

impl RepositoryCache {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the warm repository for `root`, opening it on first use.
    pub fn get(&mut self, root: &Path) -> Result<Arc<Repository>> {
        if let Some(repository) = self.open.get(root) {
            return Ok(Arc::clone(repository));
        }

        let repository = Arc::new(Repository::open(root)?);
        self.open.insert(root.to_path_buf(), Arc::clone(&repository));
        Ok(repository)
    }

    /// Drop the cached repository so the next read re-reads refs and packs.
    pub fn invalidate(&mut self, root: &Path) {
        self.open.remove(root);
    }

    pub fn clear(&mut self) {
        self.open.clear();
    }
}
