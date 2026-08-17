use std::fmt;

/// Every failure the core can report, carrying a stable machine code so the
/// Electron side can decide between surfacing a message and falling back to the
/// console backend.
#[derive(Debug)]
pub enum CoreError {
    /// The repository is in a state weavatrix-git refuses to approximate.
    Git(weavatrix_git::GitError),
    /// Worktree discovery failed.
    Scan(weavatrix_scan::Error),
    Io(std::io::Error),
    /// A well-formed request the native backend deliberately does not serve.
    Unsupported(String),
    /// The request itself was malformed.
    BadRequest(String),
}

impl CoreError {
    /// Stable code for the wire. `unsupported` is the caller's signal to use the
    /// console backend instead of showing an error.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Git(_) => "git_error",
            Self::Scan(_) => "scan_error",
            Self::Io(_) => "io_error",
            Self::Unsupported(_) => "unsupported",
            Self::BadRequest(_) => "bad_request",
        }
    }
}

impl fmt::Display for CoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Git(error) => write!(formatter, "{error}"),
            Self::Scan(error) => write!(formatter, "{error}"),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Unsupported(message) | Self::BadRequest(message) => {
                write!(formatter, "{message}")
            }
        }
    }
}

impl std::error::Error for CoreError {}

impl From<weavatrix_git::GitError> for CoreError {
    fn from(error: weavatrix_git::GitError) -> Self {
        Self::Git(error)
    }
}

impl From<weavatrix_scan::Error> for CoreError {
    fn from(error: weavatrix_scan::Error) -> Self {
        Self::Scan(error)
    }
}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
