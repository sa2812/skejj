#![deny(clippy::all)]

use napi_derive::napi;
use skejj_engine::model as engine;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[napi(string_enum)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimingPolicy {
    Asap,
    Alap,
}

#[napi(string_enum)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DependencyType {
    FinishToStart,
    StartToStart,
    FinishToFinish,
    StartToFinish,
}

#[napi(string_enum)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResourceKind {
    Equipment,
    People,
    Consumable,
}

// ---------------------------------------------------------------------------
// Enum conversions: napi → engine
// ---------------------------------------------------------------------------

impl From<TimingPolicy> for engine::TimingPolicy {
    fn from(v: TimingPolicy) -> Self {
        match v {
            TimingPolicy::Asap => engine::TimingPolicy::Asap,
            TimingPolicy::Alap => engine::TimingPolicy::Alap,
        }
    }
}

impl From<engine::TimingPolicy> for TimingPolicy {
    fn from(v: engine::TimingPolicy) -> Self {
        match v {
            engine::TimingPolicy::Asap => TimingPolicy::Asap,
            engine::TimingPolicy::Alap => TimingPolicy::Alap,
        }
    }
}

impl From<DependencyType> for engine::DependencyType {
    fn from(v: DependencyType) -> Self {
        match v {
            DependencyType::FinishToStart => engine::DependencyType::FinishToStart,
            DependencyType::StartToStart => engine::DependencyType::StartToStart,
            DependencyType::FinishToFinish => engine::DependencyType::FinishToFinish,
            DependencyType::StartToFinish => engine::DependencyType::StartToFinish,
        }
    }
}

impl From<engine::DependencyType> for DependencyType {
    fn from(v: engine::DependencyType) -> Self {
        match v {
            engine::DependencyType::FinishToStart => DependencyType::FinishToStart,
            engine::DependencyType::StartToStart => DependencyType::StartToStart,
            engine::DependencyType::FinishToFinish => DependencyType::FinishToFinish,
            engine::DependencyType::StartToFinish => DependencyType::StartToFinish,
        }
    }
}

impl From<ResourceKind> for engine::ResourceKind {
    fn from(v: ResourceKind) -> Self {
        match v {
            ResourceKind::Equipment => engine::ResourceKind::Equipment,
            ResourceKind::People => engine::ResourceKind::People,
            ResourceKind::Consumable => engine::ResourceKind::Consumable,
        }
    }
}

impl From<engine::ResourceKind> for ResourceKind {
    fn from(v: engine::ResourceKind) -> Self {
        match v {
            engine::ResourceKind::Equipment => ResourceKind::Equipment,
            engine::ResourceKind::People => ResourceKind::People,
            engine::ResourceKind::Consumable => ResourceKind::Consumable,
        }
    }
}

// ---------------------------------------------------------------------------
// Mirror types: template / input side
// ---------------------------------------------------------------------------

#[napi(object)]
#[derive(Debug, Clone)]
pub struct StepDependency {
    pub step_id: String,
    pub dependency_type: DependencyType,
}

impl From<StepDependency> for engine::StepDependency {
    fn from(v: StepDependency) -> Self {
        engine::StepDependency {
            step_id: v.step_id,
            dependency_type: v.dependency_type.into(),
        }
    }
}

impl From<engine::StepDependency> for StepDependency {
    fn from(v: engine::StepDependency) -> Self {
        StepDependency {
            step_id: v.step_id,
            dependency_type: v.dependency_type.into(),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ResourceNeed {
    pub resource_id: String,
    pub quantity: u32,
    pub min_people: Option<u32>,
    pub max_people: Option<u32>,
}

impl From<ResourceNeed> for engine::ResourceNeed {
    fn from(v: ResourceNeed) -> Self {
        engine::ResourceNeed {
            resource_id: v.resource_id,
            quantity: v.quantity,
            min_people: v.min_people,
            max_people: v.max_people,
        }
    }
}

impl From<engine::ResourceNeed> for ResourceNeed {
    fn from(v: engine::ResourceNeed) -> Self {
        ResourceNeed {
            resource_id: v.resource_id,
            quantity: v.quantity,
            min_people: v.min_people,
            max_people: v.max_people,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct Step {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub duration_mins: u32,
    pub dependencies: Vec<StepDependency>,
    pub track_id: Option<String>,
    pub timing_policy: Option<TimingPolicy>,
    pub resource_needs: Vec<ResourceNeed>,
}

impl From<Step> for engine::Step {
    fn from(v: Step) -> Self {
        engine::Step {
            id: v.id,
            title: v.title,
            description: v.description,
            duration_mins: v.duration_mins,
            dependencies: v.dependencies.into_iter().map(Into::into).collect(),
            track_id: v.track_id,
            timing_policy: v.timing_policy.map(Into::into),
            resource_needs: v.resource_needs.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<engine::Step> for Step {
    fn from(v: engine::Step) -> Self {
        Step {
            id: v.id,
            title: v.title,
            description: v.description,
            duration_mins: v.duration_mins,
            dependencies: v.dependencies.into_iter().map(Into::into).collect(),
            track_id: v.track_id,
            timing_policy: v.timing_policy.map(Into::into),
            resource_needs: v.resource_needs.into_iter().map(Into::into).collect(),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct Track {
    pub id: String,
    pub name: String,
}

impl From<Track> for engine::Track {
    fn from(v: Track) -> Self {
        engine::Track { id: v.id, name: v.name }
    }
}

impl From<engine::Track> for Track {
    fn from(v: engine::Track) -> Self {
        Track { id: v.id, name: v.name }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct Resource {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    pub capacity: u32,
    pub roles: Vec<String>,
}

impl From<Resource> for engine::Resource {
    fn from(v: Resource) -> Self {
        engine::Resource {
            id: v.id,
            name: v.name,
            kind: v.kind.into(),
            capacity: v.capacity,
            roles: v.roles,
        }
    }
}

impl From<engine::Resource> for Resource {
    fn from(v: engine::Resource) -> Self {
        Resource {
            id: v.id,
            name: v.name,
            kind: v.kind.into(),
            capacity: v.capacity,
            roles: v.roles,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct TimeConstraint {
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

impl From<TimeConstraint> for engine::TimeConstraint {
    fn from(v: TimeConstraint) -> Self {
        engine::TimeConstraint {
            start_time: v.start_time,
            end_time: v.end_time,
        }
    }
}

impl From<engine::TimeConstraint> for TimeConstraint {
    fn from(v: engine::TimeConstraint) -> Self {
        TimeConstraint {
            start_time: v.start_time,
            end_time: v.end_time,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ScheduleTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub steps: Vec<Step>,
    pub tracks: Vec<Track>,
    pub resources: Vec<Resource>,
    pub time_constraint: Option<TimeConstraint>,
    pub default_num_people: Option<u32>,
}

impl From<ScheduleTemplate> for engine::ScheduleTemplate {
    fn from(v: ScheduleTemplate) -> Self {
        engine::ScheduleTemplate {
            id: v.id,
            name: v.name,
            description: v.description,
            steps: v.steps.into_iter().map(Into::into).collect(),
            tracks: v.tracks.into_iter().map(Into::into).collect(),
            resources: v.resources.into_iter().map(Into::into).collect(),
            time_constraint: v.time_constraint.map(Into::into),
            default_num_people: v.default_num_people,
        }
    }
}

impl From<engine::ScheduleTemplate> for ScheduleTemplate {
    fn from(v: engine::ScheduleTemplate) -> Self {
        ScheduleTemplate {
            id: v.id,
            name: v.name,
            description: v.description,
            steps: v.steps.into_iter().map(Into::into).collect(),
            tracks: v.tracks.into_iter().map(Into::into).collect(),
            resources: v.resources.into_iter().map(Into::into).collect(),
            time_constraint: v.time_constraint.map(Into::into),
            default_num_people: v.default_num_people,
        }
    }
}

// ---------------------------------------------------------------------------
// Mirror types: inventory / solve-time input
// ---------------------------------------------------------------------------

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ResourceInventoryItem {
    pub resource_id: String,
    pub available_quantity: u32,
}

impl From<ResourceInventoryItem> for engine::ResourceInventoryItem {
    fn from(v: ResourceInventoryItem) -> Self {
        engine::ResourceInventoryItem {
            resource_id: v.resource_id,
            available_quantity: v.available_quantity,
        }
    }
}

impl From<engine::ResourceInventoryItem> for ResourceInventoryItem {
    fn from(v: engine::ResourceInventoryItem) -> Self {
        ResourceInventoryItem {
            resource_id: v.resource_id,
            available_quantity: v.available_quantity,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ResourceInventory {
    pub items: Vec<ResourceInventoryItem>,
}

impl From<ResourceInventory> for engine::ResourceInventory {
    fn from(v: ResourceInventory) -> Self {
        engine::ResourceInventory {
            items: v.items.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<engine::ResourceInventory> for ResourceInventory {
    fn from(v: engine::ResourceInventory) -> Self {
        ResourceInventory {
            items: v.items.into_iter().map(Into::into).collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Mirror types: solver output
// ---------------------------------------------------------------------------

#[napi(object)]
#[derive(Debug, Clone)]
pub struct AssignedResource {
    pub resource_id: String,
    pub quantity_used: u32,
}

impl From<AssignedResource> for engine::AssignedResource {
    fn from(v: AssignedResource) -> Self {
        engine::AssignedResource {
            resource_id: v.resource_id,
            quantity_used: v.quantity_used,
        }
    }
}

impl From<engine::AssignedResource> for AssignedResource {
    fn from(v: engine::AssignedResource) -> Self {
        AssignedResource {
            resource_id: v.resource_id,
            quantity_used: v.quantity_used,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SolvedStep {
    pub step_id: String,
    pub start_offset_mins: u32,
    pub end_offset_mins: u32,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub assigned_resources: Vec<AssignedResource>,
    /// Total float (slack) in minutes. Zero means this step is on the critical path.
    pub total_float_mins: u32,
    /// True when total_float_mins == 0.
    pub is_critical: bool,
}

impl From<SolvedStep> for engine::SolvedStep {
    fn from(v: SolvedStep) -> Self {
        engine::SolvedStep {
            step_id: v.step_id,
            start_offset_mins: v.start_offset_mins,
            end_offset_mins: v.end_offset_mins,
            start_time: v.start_time,
            end_time: v.end_time,
            assigned_resources: v.assigned_resources.into_iter().map(Into::into).collect(),
            total_float_mins: v.total_float_mins,
            is_critical: v.is_critical,
        }
    }
}

impl From<engine::SolvedStep> for SolvedStep {
    fn from(v: engine::SolvedStep) -> Self {
        SolvedStep {
            step_id: v.step_id,
            start_offset_mins: v.start_offset_mins,
            end_offset_mins: v.end_offset_mins,
            start_time: v.start_time,
            end_time: v.end_time,
            assigned_resources: v.assigned_resources.into_iter().map(Into::into).collect(),
            total_float_mins: v.total_float_mins,
            is_critical: v.is_critical,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ScheduleSummary {
    pub total_duration_mins: u32,
    pub critical_path_step_ids: Vec<String>,
}

impl From<ScheduleSummary> for engine::ScheduleSummary {
    fn from(v: ScheduleSummary) -> Self {
        engine::ScheduleSummary {
            total_duration_mins: v.total_duration_mins,
            critical_path_step_ids: v.critical_path_step_ids,
        }
    }
}

impl From<engine::ScheduleSummary> for ScheduleSummary {
    fn from(v: engine::ScheduleSummary) -> Self {
        ScheduleSummary {
            total_duration_mins: v.total_duration_mins,
            critical_path_step_ids: v.critical_path_step_ids,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SolvedSchedule {
    pub template_id: String,
    pub solved_steps: Vec<SolvedStep>,
    pub summary: ScheduleSummary,
    pub warnings: Vec<String>,
}

impl From<SolvedSchedule> for engine::SolvedSchedule {
    fn from(v: SolvedSchedule) -> Self {
        engine::SolvedSchedule {
            template_id: v.template_id,
            solved_steps: v.solved_steps.into_iter().map(Into::into).collect(),
            summary: v.summary.into(),
            warnings: v.warnings,
        }
    }
}

impl From<engine::SolvedSchedule> for SolvedSchedule {
    fn from(v: engine::SolvedSchedule) -> Self {
        SolvedSchedule {
            template_id: v.template_id,
            solved_steps: v.solved_steps.into_iter().map(Into::into).collect(),
            summary: v.summary.into(),
            warnings: v.warnings,
        }
    }
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

impl From<skejj_engine::validator::ValidationResult> for ValidationResult {
    fn from(v: skejj_engine::validator::ValidationResult) -> Self {
        ValidationResult {
            errors: v.errors,
            warnings: v.warnings,
        }
    }
}

impl From<ValidationResult> for skejj_engine::validator::ValidationResult {
    fn from(v: ValidationResult) -> Self {
        skejj_engine::validator::ValidationResult {
            errors: v.errors,
            warnings: v.warnings,
        }
    }
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/// Solve a schedule template using CPM (Critical Path Method).
/// Validates the template first; returns an error if validation fails.
/// Resource allocation is not yet applied (added in 02-02).
#[napi]
pub fn solve(
    template: ScheduleTemplate,
    inventory: Option<ResourceInventory>,
) -> napi::Result<SolvedSchedule> {
    let engine_template = engine::ScheduleTemplate::from(template);
    let _ = inventory.map(engine::ResourceInventory::from);

    // Validate first
    let validation = skejj_engine::validator::validate(&engine_template);
    if !validation.is_ok() {
        return Err(napi::Error::from_reason(validation.errors.join("; ")));
    }

    // Solve (CPM only in 02-01; resource allocation added in 02-02)
    skejj_engine::solver::solve(&engine_template)
        .map(|solved| solved.into())
        .map_err(|e| napi::Error::from_reason(e.to_string()))
}

/// Validate a schedule template and return errors and warnings without solving.
#[napi]
pub fn validate(template: ScheduleTemplate) -> ValidationResult {
    let engine_template = engine::ScheduleTemplate::from(template);
    skejj_engine::validator::validate(&engine_template).into()
}
