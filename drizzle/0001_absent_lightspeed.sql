CREATE TABLE `app_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `files` ADD `encrypted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `files` ADD `chunk_size` integer DEFAULT 0 NOT NULL;