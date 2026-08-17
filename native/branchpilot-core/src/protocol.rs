use serde::{Deserialize, Serialize};
use serde_json::Value;

/// One newline-delimited request from the Electron main process.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub op: String,
    #[serde(default)]
    pub params: Value,
}

/// Params shared by every repository-scoped operation.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryParams {
    pub root: String,
}

#[derive(Debug, Serialize)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
}

/// One newline-delimited response. Exactly one of `result`/`error` is present.
#[derive(Debug, Serialize)]
pub struct Response {
    pub id: u64,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorBody>,
}

impl Response {
    #[must_use]
    pub const fn ok(id: u64, result: Value) -> Self {
        Self {
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    #[must_use]
    pub fn failed(id: u64, code: &str, message: String) -> Self {
        Self {
            id,
            ok: false,
            result: None,
            error: Some(ErrorBody {
                code: code.to_owned(),
                message,
            }),
        }
    }
}
