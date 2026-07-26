ALTER TABLE `memos` ADD `done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `memos` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `notebooks` ADD `kind` text DEFAULT 'memo' NOT NULL;