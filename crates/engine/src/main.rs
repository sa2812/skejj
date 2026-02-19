use std::collections::HashMap;
use std::io::{self, Read, Write};

use serde::{Deserialize, Serialize};

use skejj_engine::model::{ResourceInventory, ResourceInventoryItem, ScheduleTemplate};
use skejj_engine::{solver, validator};

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "camelCase")]
enum Request {
    Solve {
        template: ScheduleTemplate,
        /// Simple name->count map provided by the caller. Converted to
        /// ResourceInventory by matching resource names to IDs from the template.
        inventory: Option<HashMap<String, u32>>,
    },
    Validate {
        template: ScheduleTemplate,
    },
}

#[derive(Debug, Serialize)]
struct OkResponse<T: Serialize> {
    ok: bool,
    data: T,
}

#[derive(Debug, Serialize)]
struct ErrResponse {
    ok: bool,
    error: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert a simple `{name: count}` HashMap into a `ResourceInventory` by
/// matching resource names (case-insensitive) to resource IDs from the template.
/// Inventory entries that reference unknown resource names are silently ignored.
fn build_inventory(
    template: &ScheduleTemplate,
    map: &HashMap<String, u32>,
) -> ResourceInventory {
    let items = template
        .resources
        .iter()
        .filter_map(|r| {
            // Try exact match first, then case-insensitive
            let qty = map
                .get(&r.name)
                .or_else(|| {
                    map.iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case(&r.name))
                        .map(|(_, v)| v)
                })
                .copied();
            qty.map(|available_quantity| ResourceInventoryItem {
                resource_id: r.id.clone(),
                available_quantity,
            })
        })
        .collect();
    ResourceInventory { items }
}

fn write_ok<T: Serialize>(data: T) {
    let resp = OkResponse { ok: true, data };
    let json = serde_json::to_string(&resp).unwrap_or_else(|e| {
        format!("{{\"ok\":false,\"error\":\"serialization error: {}\"}}", e)
    });
    println!("{}", json);
    let _ = io::stdout().flush();
}

fn write_err(msg: impl std::fmt::Display) -> ! {
    let resp = ErrResponse {
        ok: false,
        error: msg.to_string(),
    };
    let json = serde_json::to_string(&resp).unwrap_or_else(|_| {
        "{\"ok\":false,\"error\":\"double serialization error\"}".to_string()
    });
    println!("{}", json);
    let _ = io::stdout().flush();
    std::process::exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    // Read all of stdin
    let mut input = String::new();
    if let Err(e) = io::stdin().read_to_string(&mut input) {
        write_err(format!("Failed to read stdin: {}", e));
    }

    // Parse request
    let request: Request = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => write_err(format!("Invalid JSON input: {}", e)),
    };

    match request {
        Request::Solve { template, inventory } => {
            // Convert simple HashMap inventory to ResourceInventory if provided
            let inventory_struct: Option<ResourceInventory> =
                inventory.as_ref().map(|map| build_inventory(&template, map));

            match solver::solve(&template, inventory_struct.as_ref()) {
                Ok(solved) => write_ok(solved),
                Err(e) => write_err(e),
            }
        }
        Request::Validate { template } => {
            let result = validator::validate(&template);
            write_ok(result);
        }
    }
}
