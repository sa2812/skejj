use std::collections::HashMap;

use chrono::NaiveDateTime;
use petgraph::algo::{is_cyclic_directed, toposort};
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::visit::EdgeRef;
use petgraph::Direction;

use crate::model::{
    AssignedResource, DependencyType, ResourceInventory, ScheduleSummary, ScheduleTemplate,
    SolvedSchedule, SolvedStep, TimingPolicy,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SolveError {
    #[error("Circular dependency detected involving steps: {0}")]
    CyclicDependency(String),
    #[error("Step '{0}' references unknown dependency step '{1}'")]
    UnknownDependency(String, String),
    #[error("Step '{0}' has no duration")]
    MissingDuration(String),
    #[error("{0}")]
    ValidationFailed(String),
}

// ---------------------------------------------------------------------------
// Internal CPM result
// ---------------------------------------------------------------------------

/// Internal CPM result used to pass intermediate data to the allocator.
/// Kept as a pub(crate) struct so allocator.rs can access it.
pub(crate) struct CpmResult {
    pub solved_steps: Vec<SolvedStep>,
    /// Early start time (minutes) keyed by step_id — used by resource allocator.
    pub early_starts: HashMap<String, u32>,
    /// Late start time (minutes) keyed by step_id — used by resource allocator.
    pub late_starts: HashMap<String, u32>,
    pub project_end: u32,
}

// ---------------------------------------------------------------------------
// ISO 8601 datetime parsing helpers
// ---------------------------------------------------------------------------

const DATETIME_FORMATS: &[&str] = &[
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
];

fn parse_datetime(s: &str) -> Option<NaiveDateTime> {
    // Strip trailing Z or timezone offset for NaiveDateTime parsing.
    let s = s.trim_end_matches('Z');
    let s = if let Some(pos) = s.rfind('+') {
        if pos > 10 {
            &s[..pos]
        } else {
            s
        }
    } else {
        s
    };
    // Also strip -HH:MM timezone offsets
    let s = if s.len() > 19 && s.chars().nth(19) == Some('-') {
        &s[..19]
    } else {
        s
    };

    for fmt in DATETIME_FORMATS {
        if let Ok(dt) = NaiveDateTime::parse_from_str(s, fmt) {
            return Some(dt);
        }
    }
    // Try date-only
    if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.and_hms_opt(0, 0, 0).unwrap());
    }
    None
}

fn format_datetime(dt: NaiveDateTime) -> String {
    dt.format("%Y-%m-%dT%H:%M:%S").to_string()
}

// ---------------------------------------------------------------------------
// Core CPM implementation
// ---------------------------------------------------------------------------

/// Run the Critical Path Method on the given schedule template.
/// Returns a `CpmResult` containing intermediate CPM data that can be used
/// by the resource allocator.
pub(crate) fn cpm(template: &ScheduleTemplate) -> Result<CpmResult, SolveError> {
    // -----------------------------------------------------------------------
    // 1. Build a mapping from step_id → array index and validate durations
    // -----------------------------------------------------------------------
    let mut id_to_idx: HashMap<&str, usize> = HashMap::new();
    for (i, step) in template.steps.iter().enumerate() {
        id_to_idx.insert(step.id.as_str(), i);
    }

    // Validate: no zero durations
    for step in &template.steps {
        if step.duration_mins == 0 {
            return Err(SolveError::MissingDuration(step.id.clone()));
        }
    }

    // -----------------------------------------------------------------------
    // 2. Build petgraph DAG
    //    Node weight = step index (into template.steps)
    //    Edge weight = DependencyType
    // -----------------------------------------------------------------------
    let n = template.steps.len();
    let mut graph: DiGraph<usize, DependencyType> = DiGraph::with_capacity(n, n);

    // Add nodes first; node index == step index
    let node_indices: Vec<NodeIndex> = (0..n).map(|i| graph.add_node(i)).collect();

    // Add edges (predecessor → successor)
    for (succ_idx, step) in template.steps.iter().enumerate() {
        for dep in &step.dependencies {
            let pred_idx = match id_to_idx.get(dep.step_id.as_str()) {
                Some(&idx) => idx,
                None => {
                    return Err(SolveError::UnknownDependency(
                        step.id.clone(),
                        dep.step_id.clone(),
                    ))
                }
            };
            graph.add_edge(
                node_indices[pred_idx],
                node_indices[succ_idx],
                dep.dependency_type.clone(),
            );
        }
    }

    // -----------------------------------------------------------------------
    // 3. Detect cycles
    // -----------------------------------------------------------------------
    if is_cyclic_directed(&graph) {
        // Collect step IDs that are part of any cycle — report all steps that
        // have at least one dependency to give a useful error message.
        let cyclic_ids: Vec<String> = template
            .steps
            .iter()
            .filter(|s| !s.dependencies.is_empty())
            .map(|s| s.id.clone())
            .collect();
        return Err(SolveError::CyclicDependency(cyclic_ids.join(", ")));
    }

    // -----------------------------------------------------------------------
    // 4. Topological sort
    // -----------------------------------------------------------------------
    let topo_order = toposort(&graph, None).map_err(|_| {
        SolveError::CyclicDependency("cycle detected during topological sort".to_string())
    })?;

    // -----------------------------------------------------------------------
    // 5. Forward pass — compute Early Start (ES) and Early Finish (EF)
    //    All values in minutes (i64 to avoid underflow).
    // -----------------------------------------------------------------------
    let mut es: Vec<i64> = vec![0; n]; // Early Start
    let mut ef: Vec<i64> = vec![0; n]; // Early Finish

    for node in &topo_order {
        let step_idx = *graph.node_weight(*node).unwrap();
        let dur = template.steps[step_idx].duration_mins as i64;
        ef[step_idx] = es[step_idx] + dur;

        // Propagate to successors
        for edge in graph.edges(*node) {
            let succ_node = edge.target();
            let succ_idx = *graph.node_weight(succ_node).unwrap();
            let succ_dur = template.steps[succ_idx].duration_mins as i64;
            let dep_type = edge.weight();

            let candidate_es = match dep_type {
                DependencyType::FinishToStart => ef[step_idx],
                DependencyType::StartToStart => es[step_idx],
                DependencyType::FinishToFinish => ef[step_idx] - succ_dur,
                DependencyType::StartToFinish => es[step_idx] - succ_dur,
            };

            let new_es = candidate_es.max(0);
            if new_es > es[succ_idx] {
                es[succ_idx] = new_es;
                // EF will be recomputed when we visit this node in topo order
            }
        }

        // Recompute EF after ES has been finalized for this node
        ef[step_idx] = es[step_idx] + dur;
    }

    // Recompute EF for all nodes after forward pass (ES could have been updated
    // by earlier propagation before the node was visited)
    for i in 0..n {
        ef[i] = es[i] + template.steps[i].duration_mins as i64;
    }

    // -----------------------------------------------------------------------
    // 6. Determine project_end
    // -----------------------------------------------------------------------
    let max_ef: i64 = ef.iter().copied().max().unwrap_or(0);

    // Check for time constraints
    let (project_end, backward_only) = if let Some(tc) = &template.time_constraint {
        match (&tc.start_time, &tc.end_time) {
            (Some(start_str), Some(end_str)) => {
                // Both: compute deadline as offset from start
                if let (Some(start_dt), Some(end_dt)) =
                    (parse_datetime(start_str), parse_datetime(end_str))
                {
                    let deadline_mins =
                        (end_dt - start_dt).num_minutes().max(0) as i64;
                    (deadline_mins.max(max_ef), false)
                } else {
                    (max_ef, false)
                }
            }
            (None, Some(_)) => {
                // Backward scheduling: project_end = max_ef (relative span)
                // We'll shift wall-clock times backward from end_time
                (max_ef, true)
            }
            (Some(_), None) => (max_ef, false),
            (None, None) => (max_ef, false),
        }
    } else {
        (max_ef, false)
    };

    let _ = backward_only; // used later in wall-clock computation

    // -----------------------------------------------------------------------
    // 7. Backward pass — compute Late Start (LS) and Late Finish (LF)
    // -----------------------------------------------------------------------
    let mut lf: Vec<i64> = vec![project_end; n]; // Late Finish
    let mut ls: Vec<i64> = vec![0; n]; // Late Start

    // Initialize LS from LF
    for i in 0..n {
        ls[i] = lf[i] - template.steps[i].duration_mins as i64;
    }

    // Process in reverse topological order
    for node in topo_order.iter().rev() {
        let step_idx = *graph.node_weight(*node).unwrap();
        let dur = template.steps[step_idx].duration_mins as i64;
        ls[step_idx] = lf[step_idx] - dur;

        // Propagate to predecessors using incoming edges
        for edge in graph.edges_directed(*node, Direction::Incoming) {
            let pred_node = edge.source();
            let pred_idx = *graph.node_weight(pred_node).unwrap();
            let pred_dur = template.steps[pred_idx].duration_mins as i64;
            let dep_type = edge.weight();

            let candidate_lf = match dep_type {
                DependencyType::FinishToStart => ls[step_idx],
                DependencyType::StartToStart => ls[step_idx] + pred_dur,
                DependencyType::FinishToFinish => lf[step_idx],
                DependencyType::StartToFinish => lf[step_idx] + pred_dur,
            };

            if candidate_lf < lf[pred_idx] {
                lf[pred_idx] = candidate_lf;
                ls[pred_idx] = lf[pred_idx] - pred_dur;
            }
        }
    }

    // -----------------------------------------------------------------------
    // 8. Calculate total float and apply ASAP/ALAP placement
    // -----------------------------------------------------------------------
    let mut actual_starts: Vec<i64> = vec![0; n];
    let mut total_floats: Vec<i64> = vec![0; n];

    for (i, step) in template.steps.iter().enumerate() {
        let tf = ls[i] - es[i];
        total_floats[i] = tf.max(0);

        let policy = step.timing_policy.as_ref().unwrap_or(&TimingPolicy::Asap);
        actual_starts[i] = match policy {
            TimingPolicy::Asap => es[i],
            TimingPolicy::Alap => ls[i],
        };
    }

    // -----------------------------------------------------------------------
    // 9. Build wall-clock times
    // -----------------------------------------------------------------------
    let (start_dt_opt, end_dt_opt, is_backward) =
        if let Some(tc) = &template.time_constraint {
            let s = tc.start_time.as_deref().and_then(parse_datetime);
            let e = tc.end_time.as_deref().and_then(parse_datetime);
            let backward = tc.start_time.is_none() && tc.end_time.is_some();
            (s, e, backward)
        } else {
            (None, None, false)
        };

    // -----------------------------------------------------------------------
    // 10. Assemble SolvedStep list
    // -----------------------------------------------------------------------
    let mut solved_steps: Vec<SolvedStep> = Vec::with_capacity(n);
    let mut early_starts_map: HashMap<String, u32> = HashMap::new();
    let mut late_starts_map: HashMap<String, u32> = HashMap::new();

    for (i, step) in template.steps.iter().enumerate() {
        let actual_start = actual_starts[i].max(0) as u32;
        let dur = step.duration_mins;
        let tf = total_floats[i].max(0) as u32;

        // Wall-clock computation
        let (wc_start, wc_end) = if is_backward {
            // Backward scheduling: map relative offsets backward from end_time
            if let Some(end_dt) = end_dt_opt {
                let project_end_mins = max_ef as i64;
                let offset_from_end_start = project_end_mins - actual_start as i64;
                let offset_from_end_end = project_end_mins - (actual_start as i64 + dur as i64);
                let wall_start = end_dt
                    - chrono::Duration::minutes(offset_from_end_start);
                let wall_end = end_dt
                    - chrono::Duration::minutes(offset_from_end_end);
                (Some(format_datetime(wall_start)), Some(format_datetime(wall_end)))
            } else {
                (None, None)
            }
        } else if let Some(start_dt) = start_dt_opt {
            // Forward scheduling
            let wall_start =
                start_dt + chrono::Duration::minutes(actual_start as i64);
            let wall_end =
                start_dt + chrono::Duration::minutes((actual_start + dur) as i64);
            (Some(format_datetime(wall_start)), Some(format_datetime(wall_end)))
        } else {
            (None, None)
        };

        early_starts_map.insert(step.id.clone(), es[i].max(0) as u32);
        late_starts_map.insert(step.id.clone(), ls[i].max(0) as u32);

        solved_steps.push(SolvedStep {
            step_id: step.id.clone(),
            start_offset_mins: actual_start,
            end_offset_mins: actual_start + dur,
            start_time: wc_start,
            end_time: wc_end,
            assigned_resources: Vec::<AssignedResource>::new(),
            total_float_mins: tf,
            is_critical: tf == 0,
        });
    }

    let project_end_u32 = project_end.max(0) as u32;

    Ok(CpmResult {
        solved_steps,
        early_starts: early_starts_map,
        late_starts: late_starts_map,
        project_end: project_end_u32,
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Solve the given schedule template using CPM and optional resource allocation.
///
/// 1. Runs the Critical Path Method (CPM) to compute earliest/latest start
///    times and identify the critical path.
/// 2. If the template defines resources, runs the greedy resource allocator to
///    stagger conflicting steps within their float windows.
/// 3. Recalculates total duration after allocation (steps may be pushed out).
pub fn solve(
    template: &ScheduleTemplate,
    inventory: Option<&ResourceInventory>,
) -> Result<SolvedSchedule, SolveError> {
    let mut result = cpm(template)?;

    // Resource allocation (greedy with float-window shifting)
    let mut alloc_warnings: Vec<String> = Vec::new();
    if !template.resources.is_empty() {
        alloc_warnings = crate::allocator::allocate_resources(
            template,
            &mut result.solved_steps,
            &result.early_starts,
            &result.late_starts,
            inventory,
        );
    }

    // Recalculate total duration after allocation (steps may be pushed beyond CPM project_end)
    let total_duration_mins = result
        .solved_steps
        .iter()
        .map(|s| s.end_offset_mins)
        .max()
        .unwrap_or(result.project_end);

    let critical_path_step_ids: Vec<String> = result
        .solved_steps
        .iter()
        .filter(|s| s.is_critical)
        .map(|s| s.step_id.clone())
        .collect();

    let summary = ScheduleSummary {
        total_duration_mins,
        critical_path_step_ids,
    };

    Ok(SolvedSchedule {
        template_id: template.id.clone(),
        solved_steps: result.solved_steps,
        summary,
        warnings: alloc_warnings,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{DependencyType, ScheduleTemplate, Step, StepDependency};

    fn make_template(steps: Vec<Step>) -> ScheduleTemplate {
        ScheduleTemplate {
            id: "test".to_string(),
            name: "Test".to_string(),
            description: None,
            steps,
            tracks: vec![],
            resources: vec![],
            time_constraint: None,
            default_num_people: None,
        }
    }

    fn make_step(id: &str, dur: u32, deps: Vec<(&str, DependencyType)>) -> Step {
        Step {
            id: id.to_string(),
            title: id.to_string(),
            description: None,
            duration_mins: dur,
            dependencies: deps
                .into_iter()
                .map(|(dep_id, dt)| StepDependency {
                    step_id: dep_id.to_string(),
                    dependency_type: dt,
                })
                .collect(),
            track_id: None,
            timing_policy: None,
            resource_needs: vec![],
        }
    }

    #[test]
    fn test_single_step() {
        let template = make_template(vec![make_step("a", 30, vec![])]);
        let result = solve(&template, None).unwrap();
        assert_eq!(result.solved_steps.len(), 1);
        let s = &result.solved_steps[0];
        assert_eq!(s.step_id, "a");
        assert_eq!(s.start_offset_mins, 0);
        assert_eq!(s.end_offset_mins, 30);
        assert_eq!(s.total_float_mins, 0);
        assert!(s.is_critical);
    }

    #[test]
    fn test_linear_chain_critical_path() {
        // a(30) -> b(20): both should be critical
        let template = make_template(vec![
            make_step("a", 30, vec![]),
            make_step("b", 20, vec![("a", DependencyType::FinishToStart)]),
        ]);
        let result = solve(&template, None).unwrap();
        assert_eq!(result.summary.total_duration_mins, 50);

        let a = result.solved_steps.iter().find(|s| s.step_id == "a").unwrap();
        let b = result.solved_steps.iter().find(|s| s.step_id == "b").unwrap();

        assert_eq!(a.start_offset_mins, 0);
        assert_eq!(a.end_offset_mins, 30);
        assert_eq!(a.total_float_mins, 0);
        assert!(a.is_critical);

        assert_eq!(b.start_offset_mins, 30);
        assert_eq!(b.end_offset_mins, 50);
        assert_eq!(b.total_float_mins, 0);
        assert!(b.is_critical);
    }

    #[test]
    fn test_parallel_steps_slack() {
        // a(30) and b(10) with a->c(5) FS and b->c(5) FS
        // Critical path: a(30) + c(5) = 35; b has float of 20
        let template = make_template(vec![
            make_step("a", 30, vec![]),
            make_step("b", 10, vec![]),
            make_step(
                "c",
                5,
                vec![
                    ("a", DependencyType::FinishToStart),
                    ("b", DependencyType::FinishToStart),
                ],
            ),
        ]);
        let result = solve(&template, None).unwrap();
        assert_eq!(result.summary.total_duration_mins, 35);

        let a = result.solved_steps.iter().find(|s| s.step_id == "a").unwrap();
        let b = result.solved_steps.iter().find(|s| s.step_id == "b").unwrap();
        let c = result.solved_steps.iter().find(|s| s.step_id == "c").unwrap();

        assert_eq!(a.total_float_mins, 0);
        assert!(a.is_critical);
        assert_eq!(b.total_float_mins, 20);
        assert!(!b.is_critical);
        assert_eq!(c.total_float_mins, 0);
        assert!(c.is_critical);
    }

    #[test]
    fn test_missing_duration_error() {
        let template = make_template(vec![make_step("a", 0, vec![])]);
        let err = solve(&template, None).unwrap_err();
        assert!(matches!(err, SolveError::MissingDuration(_)));
    }

    #[test]
    fn test_unknown_dependency_error() {
        let template = make_template(vec![make_step(
            "a",
            10,
            vec![("nonexistent", DependencyType::FinishToStart)],
        )]);
        let err = solve(&template, None).unwrap_err();
        assert!(matches!(err, SolveError::UnknownDependency(_, _)));
    }
}
