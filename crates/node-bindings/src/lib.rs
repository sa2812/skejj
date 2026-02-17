#![deny(clippy::all)]

use napi_derive::napi;

/// Smoke test: proves napi-rs FFI works end-to-end.
/// Will be replaced by real exports in Plan 01-02.
#[napi]
pub fn ping() -> String {
    "pong".to_string()
}
