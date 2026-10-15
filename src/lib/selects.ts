export const ISSUE_SELECT =
  "*, machine:machines(name), reporter:profiles!maintenance_issues_reporter_id_fkey(display_name), assignee:profiles!maintenance_issues_assignee_id_fkey(display_name), schematic:schematics(title)";
