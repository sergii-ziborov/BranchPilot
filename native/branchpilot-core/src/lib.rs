//! BranchPilot's native backend.
//!
//! Reads are served in-process by [`weavatrix_git`] (no `git` subprocess, no C
//! library) and worktree discovery by [`weavatrix_scan`]. Anything the crates
//! cannot prove exactly is reported as [`CoreError::Unsupported`] so the caller
//! falls back to the console backend instead of showing an approximation.

mod attributes;
mod error;
mod git_config;
mod head_tree;
mod protocol;
mod repository;
mod status;
mod untracked;
mod worktree;

use std::path::PathBuf;

use serde_json::{Value, json};

pub use error::{CoreError, Result};
pub use git_config::GitConfig;
pub use protocol::{ErrorBody, Request, RepositoryParams, Response};
pub use repository::RepositoryCache;
pub use status::{StatusEntry, StatusPayload};

/// Dispatches wire operations against warm repositories.
#[derive(Default)]
pub struct Core {
    repositories: RepositoryCache,
}

impl Core {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Run one operation. Unknown ops are a client bug, not a fallback signal.
    pub fn dispatch(&mut self, request: &Request) -> Result<Value> {
        match request.op.as_str() {
            "ping" => Ok(json!({
                "name": env!("CARGO_PKG_NAME"),
                "version": env!("CARGO_PKG_VERSION"),
            })),
            "git.status" => self.git_status(request),
            "git.invalidate" => self.git_invalidate(request),
            "git.invalidateAll" => {
                self.repositories.clear();
                Ok(json!({ "invalidated": true }))
            }
            other => Err(CoreError::BadRequest(format!("unknown op {other:?}"))),
        }
    }

    fn git_status(&mut self, request: &Request) -> Result<Value> {
        let root = repository_root(request)?;
        let repository = self.repositories.get(&root)?;
        let payload = status::status(&repository, &root)?;

        serde_json::to_value(payload)
            .map_err(|error| CoreError::BadRequest(format!("cannot serialize status: {error}")))
    }

    fn git_invalidate(&mut self, request: &Request) -> Result<Value> {
        let root = repository_root(request)?;
        self.repositories.invalidate(&root);

        Ok(json!({ "invalidated": true }))
    }
}

fn repository_root(request: &Request) -> Result<PathBuf> {
    let params: RepositoryParams = serde_json::from_value(request.params.clone())
        .map_err(|error| CoreError::BadRequest(format!("invalid params: {error}")))?;

    if params.root.trim().is_empty() {
        return Err(CoreError::BadRequest("root is required".to_owned()));
    }

    Ok(PathBuf::from(params.root))
}
