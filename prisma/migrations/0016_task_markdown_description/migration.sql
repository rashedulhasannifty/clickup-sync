-- Store ClickUp's rich markdown_description alongside the plain-text description
-- so the dashboard can render task descriptions with formatting (headings,
-- lists, links, checkboxes). Existing rows populate on their next sync.
ALTER TABLE "clickup_tasks"
  ADD COLUMN IF NOT EXISTS "markdown_description" TEXT;
