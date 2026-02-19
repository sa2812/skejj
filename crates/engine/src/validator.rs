use std::collections::{HashMap, HashSet};

use petgraph::algo::is_cyclic_directed;
use petgraph::graph::DiGraph;
use serde::Serialize;

use crate::model::ScheduleTemplate;

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ValidationResult {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl ValidationResult {
    pub fn is_ok(&self) -> bool {
        self.errors.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Validate implementation
// ---------------------------------------------------------------------------

/// Validate a schedule template, returning errors (block solving) and
/// warnings (advisory). Errors are listed before warnings.
pub fn validate(template: &ScheduleTemplate) -> ValidationResult {
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    // Build step ID set for quick lookup
    let step_ids: HashSet<&str> = template.steps.iter().map(|s| s.id.as_str()).collect();

    // Build resource ID set for quick lookup
    let resource_ids: HashSet<&str> =
        template.resources.iter().map(|r| r.id.as_str()).collect();

    // -----------------------------------------------------------------------
    // Error: duplicate step IDs
    // -----------------------------------------------------------------------
    {
        let mut seen: HashMap<&str, bool> = HashMap::new();
        for step in &template.steps {
            if seen.insert(step.id.as_str(), true).is_some() {
                errors.push(format!(
                    "Duplicate step ID '{}' -- each step must have a unique ID",
                    step.id
                ));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Per-step errors
    // -----------------------------------------------------------------------
    for step in &template.steps {
        // Error: missing duration
        if step.duration_mins == 0 {
            errors.push(format!(
                "Step '{}' has no duration -- every step needs a duration in minutes",
                step.title
            ));
        }

        // Error: dependency references non-existent step
        for dep in &step.dependencies {
            if !step_ids.contains(dep.step_id.as_str()) {
                errors.push(format!(
                    "Step '{}' depends on '{}' which doesn't exist",
                    step.title, dep.step_id
                ));
            }
        }

        // Error: resource need references non-existent resource
        for need in &step.resource_needs {
            if !resource_ids.contains(need.resource_id.as_str()) {
                errors.push(format!(
                    "Step '{}' requires resource '{}' which isn't defined",
                    step.title, need.resource_id
                ));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Error: circular dependencies
    // -----------------------------------------------------------------------
    {
        let mut graph: DiGraph<usize, ()> =
            DiGraph::with_capacity(template.steps.len(), template.steps.len());
        let mut id_to_node: HashMap<&str, _> = HashMap::new();

        for (i, step) in template.steps.iter().enumerate() {
            let node = graph.add_node(i);
            id_to_node.insert(step.id.as_str(), node);
        }

        for step in &template.steps {
            if let Some(&succ_node) = id_to_node.get(step.id.as_str()) {
                for dep in &step.dependencies {
                    if let Some(&pred_node) = id_to_node.get(dep.step_id.as_str()) {
                        graph.add_edge(pred_node, succ_node, ());
                    }
                }
            }
        }

        if is_cyclic_directed(&graph) {
            // Collect all edges that form cycles for the error message
            let cyclic_steps: Vec<String> = template
                .steps
                .iter()
                .filter(|s| !s.dependencies.is_empty())
                .map(|s| s.id.clone())
                .collect();
            errors.push(format!(
                "Circular dependency: {} -- steps have a dependency cycle",
                cyclic_steps.join(" -> ")
            ));
        }
    }

    // -----------------------------------------------------------------------
    // Warnings
    // -----------------------------------------------------------------------
    let has_dependencies = template.steps.iter().any(|s| !s.dependencies.is_empty());
    if !has_dependencies {
        warnings.push(
            "No dependencies found -- all steps will run in parallel. Add dependencies if steps need ordering.".to_string(),
        );
    }

    if template.resources.is_empty() {
        warnings.push(
            "No resources defined -- solving without resource constraints".to_string(),
        );
    } else {
        // Warning: step with no resource needs when resources ARE defined
        for step in &template.steps {
            if step.resource_needs.is_empty() {
                warnings.push(format!(
                    "Step '{}' has no resource requirements -- it won't be resource-constrained",
                    step.title
                ));
            }
        }
    }

    // Warning: ALAP step with no deps and no successors
    {
        use crate::model::TimingPolicy;
        let steps_with_successors: HashSet<&str> = template
            .steps
            .iter()
            .flat_map(|s| s.dependencies.iter().map(|d| d.step_id.as_str()))
            .collect();

        for step in &template.steps {
            let is_alap = matches!(step.timing_policy, Some(TimingPolicy::Alap));
            if is_alap
                && step.dependencies.is_empty()
                && !steps_with_successors.contains(step.id.as_str())
            {
                warnings.push(format!(
                    "Step '{}' is set to ALAP but has no dependencies -- it will be pushed to the very end",
                    step.title
                ));
            }
        }
    }

    ValidationResult { errors, warnings }
}
