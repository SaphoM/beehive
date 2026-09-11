// ============================================================
// MEETING PREPARATION TEMPLATES
// ============================================================
// Data-driven templates that power the Smart Meeting Preparation cards. Adding a
// new meeting type = adding one entry to MEETING_TEMPLATES below — no component
// changes needed. (A future org/personal-template store backed by Supabase would
// make this truly no-code / user-editable; see the PRD's "Personal Templates"
// and "Organization Templates" sections. For now these are the built-in set.)
//
// Everything here is *suggested* content the user can edit, check/uncheck, add
// to, or remove in the prep UI. It is deterministic template content — no LLM is
// called. The PRD's history-aware AI ("your third meeting with this client",
// auto-attaching files, generated briefings) needs a backend + model and is
// explicitly out of scope for this v1.

export interface MeetingTemplate {
  id: string
  title: string
  description: string
  /** Rough baseline prep minutes for a fully-unprepared meeting of this type. */
  prepMinutes: number
  agenda: string[]
  /** Documents / preparation items that become the checklist. */
  documents: string[]
  questions: string[]
  goals: string[]
  attendees: string[]
  risks: string[]
}

export const MEETING_TEMPLATES: MeetingTemplate[] = [
  {
    id: 'board', title: 'Board Meeting', description: 'Governance & strategy', prepMinutes: 45,
    agenda: ['Welcome & apologies', 'Approve previous minutes', 'CEO report', 'Financial review', 'Risk register', 'Strategy discussion', 'Decisions', 'Action items & close'],
    documents: ['Previous minutes', 'Financial statements', 'Board pack', 'Risk register', 'Compliance reports', 'CEO report', 'Strategy deck'],
    questions: ['What are the key risks this quarter?', 'Any financial concerns or variances?', 'What are our strategic priorities?', 'What decisions need board approval today?'],
    goals: ['Approve prior minutes', 'Review financial health', 'Align on strategy', 'Record formal decisions'],
    attendees: ['Chairperson', 'CEO', 'CFO', 'Board members', 'Company secretary'],
    risks: ['Missing quorum', 'Incomplete financials', 'Undocumented decisions'],
  },
  {
    id: 'client', title: 'Client Meeting', description: 'Sales & relationships', prepMinutes: 30,
    agenda: ['Introductions', 'Recap of needs', 'Proposed solution', 'Pricing & scope', 'Q&A', 'Next steps'],
    documents: ['Proposal', 'Pricing', 'Contract', 'Product presentation', 'Case studies', 'Previous meeting notes', 'Demo material'],
    questions: ['What problem are we solving?', 'What are the success criteria?', 'What is the budget?', 'What is the timeline?', 'Who are the decision makers?', 'What are the risks?', 'What are the next steps?'],
    goals: ['Understand client needs', 'Confirm scope', 'Agree on next actions', 'Schedule follow-up'],
    attendees: ['Account owner', 'Client stakeholder', 'Solutions/technical lead', 'Decision maker'],
    risks: ['Unclear decision maker', 'Budget not confirmed', 'Scope creep'],
  },
  {
    id: 'followup', title: 'Follow-up Meeting', description: 'Progress review', prepMinutes: 15,
    agenda: ['Recap last meeting', 'Outstanding actions', 'Progress update', 'Blockers', 'Decisions', 'Next steps'],
    documents: ['Previous meeting notes', 'Action item list', 'Progress report'],
    questions: ['What actions are still outstanding?', 'What has progressed since last time?', 'What is blocking us?', 'What do we decide next?'],
    goals: ['Review outstanding actions', 'Unblock progress', 'Agree next steps'],
    attendees: ['Original attendees', 'Action owners'],
    risks: ['Stale action items', 'Missing action owners'],
  },
  {
    id: 'brainstorm', title: 'Brainstorm', description: 'Generate ideas', prepMinutes: 20,
    agenda: ['Frame the problem', 'Diverge — generate ideas', 'Cluster & theme', 'Converge — shortlist', 'Next steps'],
    documents: ['Problem statement', 'Whiteboard / board', 'Background research', 'Reference examples'],
    questions: ['What problem are we solving?', 'What constraints exist?', 'What would 10x look like?', 'Which ideas do we take forward?'],
    goals: ['Generate a wide range of ideas', 'Shortlist the strongest', 'Assign owners to explore'],
    attendees: ['Facilitator', 'Cross-functional contributors', 'Subject-matter expert'],
    risks: ['Converging too early', 'Dominant voices crowding out others'],
  },
  {
    id: 'kickoff', title: 'Project Kickoff', description: 'Start a project right', prepMinutes: 35,
    agenda: ['Project vision & scope', 'Timeline & milestones', 'Roles & responsibilities', 'Deliverables', 'Risks & dependencies', 'Success criteria', 'Next steps'],
    documents: ['Scope document', 'Timeline / plan', 'Budget', 'Team list', 'Deliverables list', 'Risk register', 'Success criteria'],
    questions: ['What is in and out of scope?', 'Who owns what?', 'What are the key milestones?', 'What could derail this?', 'How do we measure success?'],
    goals: ['Align on scope', 'Confirm roles', 'Agree timeline & success criteria'],
    attendees: ['Project manager', 'Product owner', 'Technical lead', 'Designer', 'QA lead'],
    risks: ['Unclear scope', 'Undefined ownership', 'Unrealistic timeline'],
  },
  {
    id: 'standup', title: 'Team Stand-up', description: 'Daily sync', prepMinutes: 5,
    agenda: ['Yesterday', 'Today', 'Blockers'],
    documents: ['Task board', 'Sprint board'],
    questions: ['What did you do yesterday?', 'What will you do today?', 'Anything blocking you?'],
    goals: ['Share progress', 'Surface blockers early', 'Keep the team aligned'],
    attendees: ['Team members', 'Scrum master'],
    risks: ['Turning into a status meeting', 'Running over time'],
  },
  {
    id: 'sales', title: 'Sales Meeting', description: 'Pipeline & deals', prepMinutes: 25,
    agenda: ['Pipeline review', 'Key deals', 'Blockers & risks', 'Forecast', 'Actions'],
    documents: ['Pipeline report', 'Deal notes', 'Forecast', 'Pricing', 'Proposal'],
    questions: ['Which deals are at risk?', 'What is the forecast?', 'Where do we need help?', 'What are the next actions per deal?'],
    goals: ['Review pipeline health', 'Unblock key deals', 'Commit a forecast'],
    attendees: ['Sales lead', 'Account executives', 'Sales ops'],
    risks: ['Optimistic forecasting', 'Stalled deals not flagged'],
  },
  {
    id: 'training', title: 'Training', description: 'Teach & upskill', prepMinutes: 40,
    agenda: ['Objectives', 'Core content', 'Demonstration', 'Hands-on practice', 'Q&A', 'Assessment & wrap-up'],
    documents: ['Training slides', 'Handouts', 'Exercises', 'Screen share material', 'Assessment form'],
    questions: ['What should attendees be able to do afterwards?', 'What is their current level?', 'How will we check understanding?'],
    goals: ['Deliver learning objectives', 'Confirm understanding', 'Provide follow-up resources'],
    attendees: ['Trainer', 'Trainees', 'Subject-matter expert'],
    risks: ['Content pitched at wrong level', 'No time for practice'],
  },
  {
    id: 'interview', title: 'Interview', description: 'Assess a candidate', prepMinutes: 20,
    agenda: ['Introductions', 'Role overview', 'Candidate background', 'Competency questions', 'Candidate questions', 'Next steps'],
    documents: ['CV / résumé', 'Job description', 'Evaluation form', 'Interview scorecard'],
    questions: ['Does their experience match the role?', 'How do they handle challenge X?', 'What motivates them?', 'Any red flags or concerns?'],
    goals: ['Assess fit for the role', 'Give a fair candidate experience', 'Reach a clear recommendation'],
    attendees: ['Hiring manager', 'Interviewers', 'Recruiter'],
    risks: ['Inconsistent scoring', 'Unstructured questions', 'Bias'],
  },
  {
    id: 'executive', title: 'Executive Meeting', description: 'Leadership decisions', prepMinutes: 35,
    agenda: ['Priorities update', 'Key metrics', 'Decisions required', 'Cross-team dependencies', 'Actions'],
    documents: ['Executive dashboard', 'Key metrics', 'Decision briefs', 'Department reports'],
    questions: ['What decisions are needed today?', 'Are we on track against goals?', 'What cross-team risks exist?'],
    goals: ['Align leadership', 'Make key decisions', 'Assign clear owners'],
    attendees: ['Executives', 'Department heads'],
    risks: ['Decisions deferred', 'Unclear ownership'],
  },
  {
    id: 'workshop', title: 'Workshop', description: 'Collaborate & build', prepMinutes: 40,
    agenda: ['Objectives & context', 'Warm-up', 'Working sessions', 'Share-outs', 'Synthesis', 'Actions'],
    documents: ['Agenda / run-of-show', 'Templates & worksheets', 'Whiteboard', 'Pre-read material'],
    questions: ['What outcome must we leave with?', 'What decisions are in scope?', 'Who owns the follow-through?'],
    goals: ['Produce a concrete artifact', 'Get cross-team alignment', 'Leave with owned actions'],
    attendees: ['Facilitator', 'Participants', 'Note-taker'],
    risks: ['No clear outcome', 'Under-preparation', 'Time overrun'],
  },
  {
    id: 'one-on-one', title: 'One-on-One', description: 'Manager & report', prepMinutes: 10,
    agenda: ['Check-in', 'Wins & challenges', 'Feedback (both ways)', 'Growth & goals', 'Actions'],
    documents: ['Previous 1:1 notes', 'Goals / OKRs', 'Feedback notes'],
    questions: ['How are you doing?', 'What is going well / not well?', 'What support do you need?', 'How are your goals tracking?'],
    goals: ['Build trust', 'Unblock the report', 'Support their growth'],
    attendees: ['Manager', 'Report'],
    risks: ['Cancelled repeatedly', 'One-directional (only status)'],
  },
  {
    id: 'performance', title: 'Performance Review', description: 'Evaluate & develop', prepMinutes: 30,
    agenda: ['Review period recap', 'Achievements', 'Areas to develop', 'Ratings & feedback', 'Goals for next period', 'Development plan'],
    documents: ['Self-assessment', 'Manager assessment', 'Goals from last period', '360 feedback', 'Rating rubric'],
    questions: ['Did they meet their goals?', 'What are the standout achievements?', 'What are the development areas?', 'What are next-period goals?'],
    goals: ['Give fair, balanced feedback', 'Agree development areas', 'Set clear next-period goals'],
    attendees: ['Manager', 'Employee', 'HR (if required)'],
    risks: ['Recency bias', 'No concrete examples', 'Vague goals'],
  },
  {
    id: 'sprint-planning', title: 'Sprint Planning', description: 'Plan the sprint', prepMinutes: 20,
    agenda: ['Sprint goal', 'Capacity', 'Backlog refinement', 'Commit to scope', 'Task breakdown'],
    documents: ['Product backlog', 'Team capacity', 'Definition of done', 'Previous velocity'],
    questions: ['What is the sprint goal?', 'What is our capacity?', 'Is the backlog ready & estimated?', 'What can we realistically commit to?'],
    goals: ['Agree a sprint goal', 'Commit to a realistic scope', 'Break work into tasks'],
    attendees: ['Product owner', 'Scrum master', 'Dev team'],
    risks: ['Over-committing', 'Unrefined backlog'],
  },
  {
    id: 'sprint-review', title: 'Sprint Review', description: 'Demo & inspect', prepMinutes: 20,
    agenda: ['Sprint goal recap', 'Demo completed work', 'Stakeholder feedback', 'Backlog adjustments'],
    documents: ['Sprint backlog', 'Demo environment', 'Release notes'],
    questions: ['Did we meet the sprint goal?', 'What feedback do stakeholders have?', 'What changes to the backlog?'],
    goals: ['Show working software', 'Gather feedback', 'Update the backlog'],
    attendees: ['Product owner', 'Dev team', 'Stakeholders'],
    risks: ['Demo not working', 'Low stakeholder turnout'],
  },
  {
    id: 'retro', title: 'Retrospective', description: 'Inspect & improve', prepMinutes: 15,
    agenda: ['Set the stage', 'What went well', 'What didn’t', 'Root causes', 'Action items'],
    documents: ['Previous retro actions', 'Sprint metrics', 'Retro board'],
    questions: ['What went well?', 'What should we change?', 'What is one thing we’ll try next sprint?'],
    goals: ['Surface honest feedback', 'Identify improvements', 'Commit to 1–2 concrete actions'],
    attendees: ['Scrum master', 'Dev team'],
    risks: ['Blame culture', 'Actions never followed up'],
  },
  {
    id: 'investor', title: 'Investor Meeting', description: 'Funding & updates', prepMinutes: 45,
    agenda: ['Company update', 'Key metrics & traction', 'Financials', 'Roadmap', 'The ask', 'Q&A'],
    documents: ['Pitch deck', 'Financial model', 'Metrics dashboard', 'Cap table', 'Data room link'],
    questions: ['What traction can we show?', 'What is the ask and use of funds?', 'What are the key risks?', 'What milestones will this unlock?'],
    goals: ['Show traction', 'Build investor confidence', 'Advance to next stage'],
    attendees: ['Founder / CEO', 'CFO', 'Investors'],
    risks: ['Weak metrics story', 'Unclear ask', 'Unprepared financials'],
  },
  {
    id: 'demo', title: 'Product Demo', description: 'Show the product', prepMinutes: 25,
    agenda: ['Context & goals', 'Guided demo', 'Key differentiators', 'Q&A', 'Next steps'],
    documents: ['Demo script', 'Demo environment', 'Slides', 'Screen share material', 'Feature list'],
    questions: ['What outcomes does the audience care about?', 'Which features matter most to them?', 'What are the next steps after the demo?'],
    goals: ['Show relevant value', 'Answer objections', 'Agree next steps'],
    attendees: ['Presenter', 'Solutions engineer', 'Prospect/customer'],
    risks: ['Live demo failure', 'Generic (not tailored) demo'],
  },
  {
    id: 'discovery', title: 'Discovery Call', description: 'Qualify & learn', prepMinutes: 20,
    agenda: ['Introductions', 'Current situation', 'Challenges & goals', 'Decision process', 'Next steps'],
    documents: ['Prospect research', 'Discovery question list', 'CRM record', 'Qualification framework'],
    questions: ['What are you trying to achieve?', 'What is the impact of not solving it?', 'What does your decision process look like?', 'What is the timeline?'],
    goals: ['Understand the problem', 'Qualify fit & budget', 'Agree a clear next step'],
    attendees: ['Sales rep', 'Prospect', 'Sales engineer (optional)'],
    risks: ['Pitching before understanding', 'Not qualifying budget/authority'],
  },
  {
    id: 'quarterly', title: 'Quarterly Review', description: 'QBR / results', prepMinutes: 40,
    agenda: ['Quarter recap', 'Goal attainment', 'Key metrics', 'Wins & misses', 'Next-quarter priorities', 'Actions'],
    documents: ['Quarterly report', 'KPI dashboard', 'Goals from last quarter', 'Budget vs actual'],
    questions: ['Did we hit our goals?', 'What drove the wins & misses?', 'What are next quarter’s priorities?'],
    goals: ['Assess quarter performance', 'Learn from misses', 'Set next-quarter priorities'],
    attendees: ['Team lead', 'Stakeholders', 'Cross-functional partners'],
    risks: ['Metrics not ready', 'Recap without decisions'],
  },
  {
    id: 'annual-planning', title: 'Annual Planning', description: 'Set the year', prepMinutes: 60,
    agenda: ['Vision & context', 'Prior-year review', 'Strategic themes', 'Goals & OKRs', 'Budget & resourcing', 'Roadmap', 'Commitments'],
    documents: ['Prior-year results', 'Strategy deck', 'Budget model', 'Draft OKRs', 'Roadmap'],
    questions: ['What are our top themes for the year?', 'What outcomes define success?', 'How do we resource it?', 'What are we explicitly not doing?'],
    goals: ['Agree annual strategy', 'Set measurable goals', 'Allocate budget & resources'],
    attendees: ['Leadership', 'Department heads', 'Finance'],
    risks: ['Too many priorities', 'Goals not measurable', 'No resourcing'],
  },
  {
    id: 'technical', title: 'Technical Meeting', description: 'Design & troubleshoot', prepMinutes: 30,
    agenda: ['Context & scope', 'Technical walkthrough', 'Trade-offs & alternatives', 'Open questions', 'Decisions', 'Next steps'],
    documents: ['Architecture diagram', 'Design doc / spec', 'Logs or error reports', 'Relevant code / PRs'],
    questions: ['What problem are we solving technically?', 'What are the constraints (performance, security, cost)?', 'What alternatives were considered?', 'What are the risks or trade-offs?'],
    goals: ['Align on a technical approach', 'Surface risks early', 'Record clear decisions'],
    attendees: ['Engineering lead', 'Relevant engineers', 'Architect (if needed)'],
    risks: ['Sliding into implementation detail instead of decisions', 'Missing stakeholder for a key call'],
  },
  {
    id: 'support', title: 'Support Call', description: 'Help & troubleshoot', prepMinutes: 15,
    agenda: ['Understand the issue', 'Reproduce / diagnose', 'Proposed fix or workaround', 'Timeline & next steps', 'Follow-up plan'],
    documents: ['Ticket / case notes', 'Error logs', 'Account or system details', 'Known-issues list'],
    questions: ['What exactly is happening, and since when?', 'Can it be reproduced?', 'What is the business impact?', 'What has already been tried?'],
    goals: ['Diagnose the issue', 'Set clear expectations', 'Agree next steps / SLA'],
    attendees: ['Support engineer', 'Customer / user', 'Escalation contact (if needed)'],
    risks: ['Issue not reproducible', 'Unclear severity or impact', 'No follow-up owner'],
  },
]

export const DEFAULT_TEMPLATE_ID = 'client'

export function getTemplate(id: string): MeetingTemplate | undefined {
  return MEETING_TEMPLATES.find(t => t.id === id)
}
