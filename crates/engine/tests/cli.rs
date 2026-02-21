/// Integration tests for the skejj-engine binary.
///
/// These tests spawn the compiled binary via assert_cmd and verify
/// the JSON stdin/stdout protocol for all key scenarios.
///
/// Run with: cargo test --manifest-path crates/engine/Cargo.toml
use assert_cmd::Command;
use predicates::str::contains;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn cmd() -> Command {
    Command::cargo_bin("skejj-engine").unwrap()
}

// ---------------------------------------------------------------------------
// Test 1: solve_simple_schedule
// Single step, no resources, no dependencies.
// ---------------------------------------------------------------------------

#[test]
fn solve_simple_schedule() {
    let input = r#"{
        "command": "solve",
        "template": {
            "id": "t1",
            "name": "Simple",
            "steps": [
                {
                    "id": "step-a",
                    "title": "Step A",
                    "durationMins": 30,
                    "dependencies": [],
                    "resourceNeeds": []
                }
            ],
            "tracks": [],
            "resources": []
        }
    }"#;

    cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .stdout(contains(r#""solvedSteps""#))
        .stdout(contains(r#""stepId":"step-a""#));
}

// ---------------------------------------------------------------------------
// Test 2: solve_with_dependencies
// Two steps: B depends on A (FinishToStart).
// B's startOffsetMins must equal A's endOffsetMins.
// ---------------------------------------------------------------------------

#[test]
fn solve_with_dependencies() {
    let input = r#"{
        "command": "solve",
        "template": {
            "id": "t2",
            "name": "Deps",
            "steps": [
                {
                    "id": "step-a",
                    "title": "Step A",
                    "durationMins": 20,
                    "dependencies": [],
                    "resourceNeeds": []
                },
                {
                    "id": "step-b",
                    "title": "Step B",
                    "durationMins": 15,
                    "dependencies": [
                        { "stepId": "step-a", "dependencyType": "FinishToStart" }
                    ],
                    "resourceNeeds": []
                }
            ],
            "tracks": [],
            "resources": []
        }
    }"#;

    let output = cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .stdout(contains(r#""solvedSteps""#))
        .get_output()
        .stdout
        .clone();

    let text = String::from_utf8(output).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();

    let steps = parsed["data"]["solvedSteps"].as_array().unwrap();
    let a = steps.iter().find(|s| s["stepId"] == "step-a").unwrap();
    let b = steps.iter().find(|s| s["stepId"] == "step-b").unwrap();

    // A ends at 20; B starts at 20
    assert_eq!(a["endOffsetMins"], 20);
    assert_eq!(b["startOffsetMins"], 20);
    assert_eq!(b["endOffsetMins"], 35);
}

// ---------------------------------------------------------------------------
// Test 3: solve_with_resources
// Two steps needing an oven (capacity 1); they must be serialized.
// ---------------------------------------------------------------------------

#[test]
fn solve_with_resources() {
    let input = r#"{
        "command": "solve",
        "template": {
            "id": "t3",
            "name": "Resources",
            "steps": [
                {
                    "id": "step-a",
                    "title": "Roast A",
                    "durationMins": 30,
                    "dependencies": [],
                    "resourceNeeds": [
                        { "resourceId": "oven", "quantity": 1 }
                    ]
                },
                {
                    "id": "step-b",
                    "title": "Roast B",
                    "durationMins": 20,
                    "dependencies": [],
                    "resourceNeeds": [
                        { "resourceId": "oven", "quantity": 1 }
                    ]
                }
            ],
            "tracks": [],
            "resources": [
                {
                    "id": "oven",
                    "name": "Oven",
                    "kind": "Equipment",
                    "capacity": 1,
                    "roles": []
                }
            ]
        }
    }"#;

    let output = cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .stdout(contains(r#""solvedSteps""#))
        .stdout(contains(r#""assignedResources""#))
        .get_output()
        .stdout
        .clone();

    let text = String::from_utf8(output).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();

    let steps = parsed["data"]["solvedSteps"].as_array().unwrap();
    let a = steps.iter().find(|s| s["stepId"] == "step-a").unwrap();
    let b = steps.iter().find(|s| s["stepId"] == "step-b").unwrap();

    // Steps must not overlap (oven capacity 1)
    let a_end = a["endOffsetMins"].as_u64().unwrap();
    let b_start = b["startOffsetMins"].as_u64().unwrap();
    let a_start = a["startOffsetMins"].as_u64().unwrap();
    let b_end = b["endOffsetMins"].as_u64().unwrap();

    // One must start after the other finishes
    let no_overlap = b_start >= a_end || a_start >= b_end;
    assert!(no_overlap, "Steps with oven conflict must not overlap: a=[{},{}), b=[{},{})", a_start, a_end, b_start, b_end);
}

// ---------------------------------------------------------------------------
// Test 4: solve_with_inventory
// Inventory overrides resource capacity; response must contain warnings.
// ---------------------------------------------------------------------------

#[test]
fn solve_with_inventory() {
    let input = r#"{
        "command": "solve",
        "inventory": { "Oven": 1 },
        "template": {
            "id": "t4",
            "name": "Inventory",
            "steps": [
                {
                    "id": "step-a",
                    "title": "Use Oven",
                    "durationMins": 30,
                    "dependencies": [],
                    "resourceNeeds": [
                        { "resourceId": "oven", "quantity": 1 }
                    ]
                }
            ],
            "tracks": [],
            "resources": [
                {
                    "id": "oven",
                    "name": "Oven",
                    "kind": "Equipment",
                    "capacity": 2,
                    "roles": []
                }
            ]
        }
    }"#;

    cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .stdout(contains("Inventory override"))
        .stdout(contains("Oven"));
}

// ---------------------------------------------------------------------------
// Test 5: validate_valid_schedule
// A valid schedule must return ok:true and empty errors array.
// ---------------------------------------------------------------------------

#[test]
fn validate_valid_schedule() {
    let input = r#"{
        "command": "validate",
        "template": {
            "id": "t5",
            "name": "Valid",
            "steps": [
                {
                    "id": "step-a",
                    "title": "Step A",
                    "durationMins": 10,
                    "dependencies": [],
                    "resourceNeeds": []
                },
                {
                    "id": "step-b",
                    "title": "Step B",
                    "durationMins": 10,
                    "dependencies": [
                        { "stepId": "step-a", "dependencyType": "FinishToStart" }
                    ],
                    "resourceNeeds": []
                }
            ],
            "tracks": [],
            "resources": []
        }
    }"#;

    let output = cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .get_output()
        .stdout
        .clone();

    let text = String::from_utf8(output).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();

    // Validation result data has errors array
    let errors = parsed["data"]["errors"].as_array().unwrap();
    assert!(errors.is_empty(), "Valid schedule should have no errors, got: {:?}", errors);
}

// ---------------------------------------------------------------------------
// Test 6: validate_invalid_schedule
// Duplicate step IDs and missing dependency reference must produce errors.
// ---------------------------------------------------------------------------

#[test]
fn validate_invalid_schedule() {
    let input = r#"{
        "command": "validate",
        "template": {
            "id": "t6",
            "name": "Invalid",
            "steps": [
                {
                    "id": "dup",
                    "title": "Duplicate 1",
                    "durationMins": 10,
                    "dependencies": [],
                    "resourceNeeds": []
                },
                {
                    "id": "dup",
                    "title": "Duplicate 2",
                    "durationMins": 10,
                    "dependencies": [
                        { "stepId": "nonexistent-step", "dependencyType": "FinishToStart" }
                    ],
                    "resourceNeeds": []
                }
            ],
            "tracks": [],
            "resources": []
        }
    }"#;

    let output = cmd()
        .write_stdin(input)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .get_output()
        .stdout
        .clone();

    let text = String::from_utf8(output).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();

    // Must have validation errors
    let errors = parsed["data"]["errors"].as_array().unwrap();
    assert!(!errors.is_empty(), "Invalid schedule must report errors");
}

// ---------------------------------------------------------------------------
// Test 7: invalid_json_input
// Malformed JSON must make the binary exit with code 1 and ok:false.
// ---------------------------------------------------------------------------

#[test]
fn invalid_json_input() {
    let input = r#"{ this is not valid json "#;

    cmd()
        .write_stdin(input)
        .assert()
        .failure()
        .stdout(contains(r#""ok":false"#))
        .stdout(contains("error"));
}

// ---------------------------------------------------------------------------
// Test 8: unknown_command
// JSON with an unknown command value must be handled gracefully (ok:false).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test 9: solve_with_consumable_inventory_override
// Proves the RES-04 bug fix: consumable_remaining now initializes from the
// inventory-overridden resource_capacity, not from r.capacity.
//
// Setup: one consumable resource "dough" with template capacity 100.
//        Two steps each consuming 80 units (total 160 > 100 → shortage).
//
// Without inventory: warnings must contain "may run out" for dough.
// With inventory {"dough": 200}: 160 <= 200 so NO "may run out" warning,
//   but an "Inventory override" warning IS expected.
// ---------------------------------------------------------------------------

#[test]
fn unknown_command() {
    let input = r#"{
        "command": "unknownCommand",
        "template": {
            "id": "t8",
            "name": "Unknown",
            "steps": [],
            "tracks": [],
            "resources": []
        }
    }"#;

    cmd()
        .write_stdin(input)
        .assert()
        .failure()
        .stdout(contains(r#""ok":false"#))
        .stdout(contains("error"));
}

#[test]
fn solve_with_consumable_inventory_override() {
    // Template: dough is Consumable with capacity 100.
    // Two independent steps each needing 80 dough → total 160 > 100 → shortage without override.
    let base_template = r#"{
        "id": "t9",
        "name": "ConsumableOverride",
        "steps": [
            {
                "id": "step-a",
                "title": "Mix A",
                "durationMins": 20,
                "dependencies": [],
                "resourceNeeds": [
                    { "resourceId": "dough", "quantity": 80 }
                ]
            },
            {
                "id": "step-b",
                "title": "Mix B",
                "durationMins": 20,
                "dependencies": [],
                "resourceNeeds": [
                    { "resourceId": "dough", "quantity": 80 }
                ]
            }
        ],
        "tracks": [],
        "resources": [
            {
                "id": "dough",
                "name": "dough",
                "kind": "Consumable",
                "capacity": 100,
                "roles": []
            }
        ]
    }"#;

    // -------------------------------------------------------------------------
    // Without inventory: 80 + 80 = 160 > 100 → at least one "may run out" warning
    // -------------------------------------------------------------------------
    let input_no_inv = format!(r#"{{"command":"solve","template":{}}}"#, base_template);

    let output_no_inv = cmd()
        .write_stdin(input_no_inv)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .get_output()
        .stdout
        .clone();

    let text_no_inv = String::from_utf8(output_no_inv).unwrap();
    let parsed_no_inv: serde_json::Value = serde_json::from_str(&text_no_inv).unwrap();

    let warnings_no_inv = parsed_no_inv["data"]["warnings"].as_array().unwrap();
    let has_shortage = warnings_no_inv
        .iter()
        .any(|w| w.as_str().unwrap_or("").contains("may run out"));
    assert!(
        has_shortage,
        "Without inventory override, expected a consumable shortage warning. Got warnings: {:?}",
        warnings_no_inv
    );

    // -------------------------------------------------------------------------
    // With inventory {"dough": 200}: 80 + 80 = 160 <= 200 → NO shortage warning.
    // Should have an "Inventory override" warning confirming the override took effect.
    // -------------------------------------------------------------------------
    let input_with_inv = format!(
        r#"{{"command":"solve","inventory":{{"dough":200}},"template":{}}}"#,
        base_template
    );

    let output_with_inv = cmd()
        .write_stdin(input_with_inv)
        .assert()
        .success()
        .stdout(contains(r#""ok":true"#))
        .get_output()
        .stdout
        .clone();

    let text_with_inv = String::from_utf8(output_with_inv).unwrap();
    let parsed_with_inv: serde_json::Value = serde_json::from_str(&text_with_inv).unwrap();

    let warnings_with_inv = parsed_with_inv["data"]["warnings"].as_array().unwrap();

    let no_shortage = warnings_with_inv
        .iter()
        .all(|w| !w.as_str().unwrap_or("").contains("may run out"));
    assert!(
        no_shortage,
        "With inventory override dough=200, expected NO consumable shortage warning. Got warnings: {:?}",
        warnings_with_inv
    );

    let has_override_warning = warnings_with_inv
        .iter()
        .any(|w| w.as_str().unwrap_or("").contains("Inventory override"));
    assert!(
        has_override_warning,
        "With inventory override dough=200, expected an 'Inventory override' warning. Got warnings: {:?}",
        warnings_with_inv
    );
}
