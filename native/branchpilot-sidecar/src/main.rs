//! Newline-delimited JSON stdio server for BranchPilot's Electron main process.
//!
//! One JSON object per line in, one per line out. stdout carries protocol only;
//! diagnostics go to stderr. The process is long-lived so repositories, packs,
//! commit-graphs and index snapshots stay warm between requests.

use std::io::{self, BufRead, Write};
use std::process::ExitCode;

use branchpilot_core::{Core, Request, Response};

fn main() -> ExitCode {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    let mut core = Core::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                eprintln!("branchpilot-sidecar: stdin closed: {error}");
                return ExitCode::FAILURE;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = handle(&mut core, &line);

        if let Err(error) = write_response(&mut stdout, &response) {
            eprintln!("branchpilot-sidecar: stdout closed: {error}");
            return ExitCode::FAILURE;
        }
    }

    ExitCode::SUCCESS
}

fn handle(core: &mut Core, line: &str) -> Response {
    let request: Request = match serde_json::from_str(line) {
        Ok(request) => request,
        // Without a parsed id there is nothing to correlate; id 0 is reserved
        // for exactly this case and the client rejects the whole line.
        Err(error) => return Response::failed(0, "bad_request", error.to_string()),
    };

    match core.dispatch(&request) {
        Ok(result) => Response::ok(request.id, result),
        Err(error) => Response::failed(request.id, error.code(), error.to_string()),
    }
}

fn write_response(stdout: &mut impl Write, response: &Response) -> io::Result<()> {
    let encoded = serde_json::to_string(response)
        .unwrap_or_else(|error| format!(r#"{{"id":0,"ok":false,"error":{{"code":"internal","message":"{error}"}}}}"#));

    stdout.write_all(encoded.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}
