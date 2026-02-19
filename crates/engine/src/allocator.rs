use std::collections::HashMap;

use crate::model::{
    AssignedResource, ResourceInventory, ResourceKind, ScheduleTemplate, SolvedStep, TimingPolicy,
};

// ---------------------------------------------------------------------------
// Timeline tracker for Equipment and People resources
// ---------------------------------------------------------------------------

/// A single reserved interval on a resource timeline.
#[derive(Debug, Clone)]
struct Reservation {
    start: u32,
    end: u32,
    quantity: u32,
}

/// Per-resource interval list for Equipment and People.
/// Tracks time-windowed usage; supports range capacity queries.
#[derive(Debug, Default)]
struct ResourceTimeline {
    reservations: Vec<Reservation>,
}

impl ResourceTimeline {
    /// Sum of quantities whose intervals overlap the half-open range [start, end).
    fn used_at_range(&self, start: u32, end: u32) -> u32 {
        self.reservations
            .iter()
            .filter(|r| r.start < end && r.end > start)
            .map(|r| r.quantity)
            .sum()
    }

    /// Reserve [start, end) with the given quantity.
    fn reserve(&mut self, start: u32, end: u32, quantity: u32) {
        self.reservations.push(Reservation { start, end, quantity });
    }
}

// ---------------------------------------------------------------------------
// Public allocation function
// ---------------------------------------------------------------------------

/// Apply greedy resource allocation with float-window shifting to the solved steps.
///
/// Steps are processed in priority order:
/// 1. Critical path steps first (is_critical == true)
/// 2. Then by early start ascending
/// 3. Tie-break by duration descending
///
/// When `inventory` is provided, its quantities override the template capacity
/// for matching resources. A warning is emitted for each override.
///
/// Returns a list of human-readable warnings for any constraint relaxations.
pub fn allocate_resources(
    template: &ScheduleTemplate,
    solved_steps: &mut Vec<SolvedStep>,
    early_starts: &HashMap<String, u32>,
    late_starts: &HashMap<String, u32>,
    inventory: Option<&ResourceInventory>,
) -> Vec<String> {
    let mut warnings: Vec<String> = Vec::new();

    if template.resources.is_empty() {
        return warnings;
    }

    // Build a lookup: step_id -> resource_needs from template
    let step_needs: HashMap<&str, _> = template
        .steps
        .iter()
        .map(|s| (s.id.as_str(), &s.resource_needs))
        .collect();

    // Build a lookup: step_id -> title (for warning messages)
    let step_titles: HashMap<&str, &str> = template
        .steps
        .iter()
        .map(|s| (s.id.as_str(), s.title.as_str()))
        .collect();

    // Build a lookup: step_id -> timing_policy
    let step_policies: HashMap<&str, &TimingPolicy> = template
        .steps
        .iter()
        .filter_map(|s| s.timing_policy.as_ref().map(|p| (s.id.as_str(), p)))
        .collect();

    // Build resource capacity map: resource_id -> capacity
    // Start from template capacities, then apply inventory overrides.
    let mut resource_capacity: HashMap<&str, u32> = template
        .resources
        .iter()
        .map(|r| (r.id.as_str(), r.capacity))
        .collect();

    // Apply inventory overrides and emit warnings
    if let Some(inv) = inventory {
        for item in &inv.items {
            if let Some(template_cap) = resource_capacity.get_mut(item.resource_id.as_str()) {
                let inv_qty = item.available_quantity;
                let tmpl_cap = *template_cap;
                // Find the resource name for the warning message
                let rname = template
                    .resources
                    .iter()
                    .find(|r| r.id == item.resource_id)
                    .map(|r| r.name.as_str())
                    .unwrap_or(item.resource_id.as_str());
                warnings.push(format!(
                    "Inventory override: '{}' limited to {} (template defines {})",
                    rname, inv_qty, tmpl_cap
                ));
                *template_cap = inv_qty;
            }
            // If the resource_id from inventory doesn't match any template resource, ignore it
        }
    }

    // Build resource name map: resource_id -> name
    let resource_names: HashMap<&str, &str> = template
        .resources
        .iter()
        .map(|r| (r.id.as_str(), r.name.as_str()))
        .collect();

    // Build resource kind map: resource_id -> kind
    let resource_kinds: HashMap<&str, &ResourceKind> = template
        .resources
        .iter()
        .map(|r| (r.id.as_str(), &r.kind))
        .collect();

    // -----------------------------------------------------------------------
    // Step 1: Build sort order indices
    // -----------------------------------------------------------------------

    // Create a sorted index list
    let mut order: Vec<usize> = (0..solved_steps.len()).collect();
    order.sort_by(|&a, &b| {
        let sa = &solved_steps[a];
        let sb = &solved_steps[b];

        // 1. Critical path first
        let crit_ord = sb.is_critical.cmp(&sa.is_critical);
        if crit_ord != std::cmp::Ordering::Equal {
            return crit_ord;
        }

        // 2. Earlier ES first
        let es_a = early_starts.get(&sa.step_id).copied().unwrap_or(0);
        let es_b = early_starts.get(&sb.step_id).copied().unwrap_or(0);
        let es_ord = es_a.cmp(&es_b);
        if es_ord != std::cmp::Ordering::Equal {
            return es_ord;
        }

        // 3. Longer duration first (harder to place)
        let dur_a = sa.end_offset_mins.saturating_sub(sa.start_offset_mins);
        let dur_b = sb.end_offset_mins.saturating_sub(sb.start_offset_mins);
        dur_b.cmp(&dur_a)
    });

    // -----------------------------------------------------------------------
    // Step 2: Initialize timelines and consumable tracking
    // -----------------------------------------------------------------------

    let mut timelines: HashMap<String, ResourceTimeline> = template
        .resources
        .iter()
        .filter(|r| !matches!(r.kind, ResourceKind::Consumable))
        .map(|r| (r.id.clone(), ResourceTimeline::default()))
        .collect();

    // Consumable: track remaining quantity
    let mut consumable_remaining: HashMap<String, u32> = template
        .resources
        .iter()
        .filter(|r| matches!(r.kind, ResourceKind::Consumable))
        .map(|r| (r.id.clone(), r.capacity))
        .collect();

    // -----------------------------------------------------------------------
    // Step 3: Allocate each step in priority order
    // -----------------------------------------------------------------------

    for idx in order {
        let step_id = solved_steps[idx].step_id.clone();
        let step_id_str = step_id.as_str();

        let needs = match step_needs.get(step_id_str) {
            Some(n) if !n.is_empty() => *n,
            _ => continue, // No resource needs — skip allocation, leave CPM times
        };

        let es = early_starts.get(step_id_str).copied().unwrap_or(0);
        let ls = late_starts.get(step_id_str).copied().unwrap_or(es);
        let duration = solved_steps[idx].end_offset_mins - solved_steps[idx].start_offset_mins;
        let is_alap = matches!(
            step_policies.get(step_id_str),
            Some(TimingPolicy::Alap)
        );

        // Handle consumables: check availability and emit warnings before placement
        for need in needs.iter() {
            let kind = resource_kinds.get(need.resource_id.as_str());
            if matches!(kind, Some(ResourceKind::Consumable)) {
                let remaining = consumable_remaining
                    .get(need.resource_id.as_str())
                    .copied()
                    .unwrap_or(0);
                if remaining < need.quantity {
                    let rname = resource_names
                        .get(need.resource_id.as_str())
                        .copied()
                        .unwrap_or(need.resource_id.as_str());
                    warnings.push(format!(
                        "Consumable '{}' may run out -- {} needed but only {} available",
                        rname, need.quantity, remaining
                    ));
                }
            }
        }

        // Separate timed needs (Equipment/People) from consumable needs
        let timed_needs: Vec<_> = needs
            .iter()
            .filter(|n| {
                !matches!(
                    resource_kinds.get(n.resource_id.as_str()),
                    Some(ResourceKind::Consumable)
                )
            })
            .collect();

        // -----------------------------------------------------------------------
        // Find feasible start for timed resources
        // -----------------------------------------------------------------------

        let feasible_start: u32;
        let mut pushed_past_float = false;
        let mut blocking_resource_name = String::new();

        if timed_needs.is_empty() {
            // Only consumables — keep CPM-computed start
            feasible_start = solved_steps[idx].start_offset_mins;
        } else if is_alap {
            // ALAP: find LATEST feasible start in [es, ls]
            // Gather candidate times from interval boundaries, then scan backward
            let mut candidates: Vec<u32> = vec![ls];
            for need in &timed_needs {
                if let Some(timeline) = timelines.get(need.resource_id.as_str()) {
                    for r in &timeline.reservations {
                        // Time just before a reservation starts (latest we can finish before it)
                        if r.start >= duration {
                            let c = r.start.saturating_sub(duration);
                            if c >= es && c <= ls {
                                candidates.push(c);
                            }
                        }
                        // Time right after a reservation ends (can start there)
                        if r.end >= es && r.end <= ls {
                            candidates.push(r.end);
                        }
                    }
                }
            }
            candidates.push(es);
            candidates.sort_unstable();
            candidates.dedup();

            let mut latest: Option<u32> = None;

            // Scan backward through candidates
            for &t in candidates.iter().rev() {
                if t > ls {
                    continue;
                }
                let ok = timed_needs.iter().all(|need| {
                    let cap = resource_capacity
                        .get(need.resource_id.as_str())
                        .copied()
                        .unwrap_or(0);
                    if let Some(timeline) = timelines.get(need.resource_id.as_str()) {
                        timeline.used_at_range(t, t + duration) + need.quantity <= cap
                    } else {
                        false
                    }
                });
                if ok {
                    latest = Some(t);
                    break;
                }
            }

            if let Some(start) = latest {
                feasible_start = start;
            } else {
                // No slot in [es, ls] — scan forward from es (fallback: ALAP pushed past float)
                let (found, bad_rname) = find_earliest_feasible(
                    es,
                    duration,
                    &timed_needs,
                    &timelines,
                    &resource_capacity,
                    &resource_names,
                );
                feasible_start = found;
                if feasible_start > ls {
                    pushed_past_float = true;
                    blocking_resource_name = bad_rname;
                }
            }
        } else {
            // ASAP: find EARLIEST feasible start >= es
            let (found, bad_rname) = find_earliest_feasible(
                es,
                duration,
                &timed_needs,
                &timelines,
                &resource_capacity,
                &resource_names,
            );
            feasible_start = found;
            if feasible_start > ls {
                pushed_past_float = true;
                blocking_resource_name = bad_rname;
            }
        }

        // Emit warning if step was pushed past its float
        if pushed_past_float {
            let title = step_titles.get(step_id_str).copied().unwrap_or(step_id_str);
            let rname = if blocking_resource_name.is_empty() {
                "resource".to_string()
            } else {
                blocking_resource_name.clone()
            };
            warnings.push(format!(
                "Step '{}' was delayed beyond its available slack due to resource conflict with '{}'",
                title, rname
            ));
        }

        // -----------------------------------------------------------------------
        // Place the step: update start/end and reserve resources
        // -----------------------------------------------------------------------
        solved_steps[idx].start_offset_mins = feasible_start;
        solved_steps[idx].end_offset_mins = feasible_start + duration;

        let mut assigned: Vec<AssignedResource> = Vec::new();

        for need in needs.iter() {
            let kind = resource_kinds.get(need.resource_id.as_str());
            match kind {
                Some(ResourceKind::Consumable) => {
                    // Decrement consumable
                    if let Some(remaining) = consumable_remaining.get_mut(need.resource_id.as_str()) {
                        let used = need.quantity.min(*remaining);
                        *remaining = remaining.saturating_sub(need.quantity);
                        assigned.push(AssignedResource {
                            resource_id: need.resource_id.clone(),
                            quantity_used: used,
                        });
                    }
                }
                Some(ResourceKind::Equipment) | Some(ResourceKind::People) => {
                    if let Some(timeline) = timelines.get_mut(need.resource_id.as_str()) {
                        timeline.reserve(feasible_start, feasible_start + duration, need.quantity);
                    }
                    assigned.push(AssignedResource {
                        resource_id: need.resource_id.clone(),
                        quantity_used: need.quantity,
                    });
                }
                None => {
                    // Unknown resource kind — skip silently
                }
            }
        }

        solved_steps[idx].assigned_resources = assigned;
    }

    warnings
}

// ---------------------------------------------------------------------------
// Helper: find earliest feasible start >= search_from using boundary-jump scan
// ---------------------------------------------------------------------------

/// Returns (feasible_start, blocking_resource_name).
/// `blocking_resource_name` is the name of the first resource that prevented the
/// step from starting at `search_from` (used for warning messages when the step
/// is ultimately placed past its late start).
fn find_earliest_feasible(
    search_from: u32,
    duration: u32,
    timed_needs: &[&crate::model::ResourceNeed],
    timelines: &HashMap<String, ResourceTimeline>,
    resource_capacity: &HashMap<&str, u32>,
    resource_names: &HashMap<&str, &str>,
) -> (u32, String) {
    // Build candidate start times from reservation boundaries
    let mut candidates: Vec<u32> = vec![search_from];
    for need in timed_needs {
        if let Some(timeline) = timelines.get(need.resource_id.as_str()) {
            for r in &timeline.reservations {
                if r.end >= search_from {
                    candidates.push(r.end);
                }
            }
        }
    }
    candidates.sort_unstable();
    candidates.dedup();

    // Track the resource that first blocked the step at search_from
    let mut first_blocker = String::new();
    let mut found_start: Option<u32> = None;

    for t in candidates {
        let (ok, bad) = check_all_timed(t, duration, timed_needs, timelines, resource_capacity);
        if ok {
            found_start = Some(t);
            break;
        } else if let Some(rid) = bad {
            // Record the first blocking resource (at search_from)
            if first_blocker.is_empty() {
                first_blocker = resource_names
                    .get(rid.as_str())
                    .copied()
                    .unwrap_or(rid.as_str())
                    .to_string();
            }
        }
    }

    // If no boundary-based candidate worked, fall back to search_from.
    // This should not happen in practice since the empty state is always feasible.
    (found_start.unwrap_or(search_from), first_blocker)
}

// ---------------------------------------------------------------------------
// Helper: check all timed resource needs at a candidate time
// Returns (feasible: bool, blocking_resource_id: Option<String>)
// ---------------------------------------------------------------------------

fn check_all_timed(
    t: u32,
    duration: u32,
    timed_needs: &[&crate::model::ResourceNeed],
    timelines: &HashMap<String, ResourceTimeline>,
    resource_capacity: &HashMap<&str, u32>,
) -> (bool, Option<String>) {
    for need in timed_needs {
        let cap = resource_capacity
            .get(need.resource_id.as_str())
            .copied()
            .unwrap_or(0);
        let used = timelines
            .get(need.resource_id.as_str())
            .map(|tl| tl.used_at_range(t, t + duration))
            .unwrap_or(0);
        if used + need.quantity > cap {
            return (false, Some(need.resource_id.clone()));
        }
    }
    (true, None)
}
