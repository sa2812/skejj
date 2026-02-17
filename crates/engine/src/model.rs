use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Per-step scheduling policy: schedule as soon as possible or as late as
/// possible within the available window.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TimingPolicy {
    Asap,
    Alap,
}

/// The four standard dependency relationship types used in project scheduling.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DependencyType {
    /// Successor starts after predecessor finishes (most common).
    FinishToStart,
    /// Successor starts after predecessor starts.
    StartToStart,
    /// Successor finishes after predecessor finishes.
    FinishToFinish,
    /// Successor finishes after predecessor starts.
    StartToFinish,
}

/// Category of a resource, which determines how capacity and quantity are
/// interpreted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ResourceKind {
    /// Physical asset with integer slot capacity (e.g. an oven with 3 spaces).
    Equipment,
    /// Human resources; capacity = total headcount available.
    People,
    /// Items consumed during execution (quantity decreases as steps run).
    Consumable,
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/// A directed dependency from one step to another.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepDependency {
    /// The ID of the predecessor step.
    pub step_id: String,
    pub dependency_type: DependencyType,
}

/// What a single step requires from a resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceNeed {
    /// References a `Resource` by its ID.
    pub resource_id: String,
    /// How many units/slots/people are needed.
    pub quantity: u32,
    /// For People resources: optional lower bound (overrides `quantity` as the
    /// minimum when set).
    pub min_people: Option<u32>,
    /// For People resources: optional upper bound on how many may be assigned.
    pub max_people: Option<u32>,
}

// ---------------------------------------------------------------------------
// Template types (no concrete wall-clock times)
// ---------------------------------------------------------------------------

/// A single work unit in a schedule template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    /// Duration of this step in minutes. Must be > 0.
    pub duration_mins: u32,
    /// Predecessor dependencies with their relationship type.
    pub dependencies: Vec<StepDependency>,
    /// Optional membership in a `Track`.
    pub track_id: Option<String>,
    /// Scheduling policy for this step. Defaults to ASAP when `None`.
    pub timing_policy: Option<TimingPolicy>,
    /// Resource requirements for this step.
    pub resource_needs: Vec<ResourceNeed>,
}

/// Organizational grouping of steps (e.g. "Kitchen", "Prep Station").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    pub id: String,
    pub name: String,
}

/// A resource defined by a schedule template.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    /// Interpretation depends on `kind`:
    /// - Equipment: number of simultaneous slots.
    /// - People: total headcount available in the template.
    /// - Consumable: total quantity available in the template.
    pub capacity: u32,
    /// Named roles within a People resource (e.g. ["driver", "navigator"]).
    /// Empty by default.
    pub roles: Vec<String>,
}

/// Schedule-level time constraint that drives forward or backward scheduling.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeConstraint {
    /// ISO 8601 datetime string: drives forward scheduling from this point.
    pub start_time: Option<String>,
    /// ISO 8601 datetime string: drives backward scheduling from this point.
    pub end_time: Option<String>,
}

/// The user-defined schedule template. Contains no concrete wall-clock times.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<Step>,
    pub tracks: Vec<Track>,
    pub resources: Vec<Resource>,
    pub time_constraint: Option<TimeConstraint>,
    /// Fallback headcount for steps that declare no explicit people need.
    pub default_num_people: Option<u32>,
}

// ---------------------------------------------------------------------------
// Resource inventory (solve-time input)
// ---------------------------------------------------------------------------

/// Declares how many of a particular resource the user actually has available
/// at solve time. This may differ from the template's theoretical `capacity`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInventoryItem {
    /// References a `Resource` by its ID.
    pub resource_id: String,
    pub available_quantity: u32,
}

/// The complete set of real-world resource availability provided at solve time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInventory {
    pub items: Vec<ResourceInventoryItem>,
}

// ---------------------------------------------------------------------------
// Solver output types (concrete times)
// ---------------------------------------------------------------------------

/// Records which resource was assigned to a solved step, and how much.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignedResource {
    pub resource_id: String,
    pub quantity_used: u32,
}

/// A step in a solved schedule with concrete timing information.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolvedStep {
    /// References a `Step` from the template.
    pub step_id: String,
    /// Minutes from schedule start (always non-negative).
    pub start_offset_mins: u32,
    pub end_offset_mins: u32,
    /// Wall-clock start time (ISO 8601) — populated when `ScheduleTemplate`
    /// has a `time_constraint.start_time`.
    pub start_time: Option<String>,
    /// Wall-clock end time (ISO 8601) — populated alongside `start_time`.
    pub end_time: Option<String>,
    pub assigned_resources: Vec<AssignedResource>,
}

/// Schedule-level metadata produced alongside the solved steps.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleSummary {
    pub total_duration_mins: u32,
    pub critical_path_step_ids: Vec<String>,
}

/// The complete solver output: every step has concrete timing plus summary
/// metadata and any warnings generated during solving.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolvedSchedule {
    /// References the originating `ScheduleTemplate` by ID.
    pub template_id: String,
    pub solved_steps: Vec<SolvedStep>,
    pub summary: ScheduleSummary,
    /// Human-readable warnings (e.g. consumable shortfalls, constraint
    /// violations that were relaxed).
    pub warnings: Vec<String>,
}
