CREATE TABLE `trash` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`notebook_id` text,
	`payload` text NOT NULL,
	`deleted_at` integer DEFAULT (unixepoch()) NOT NULL
);
