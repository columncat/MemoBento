CREATE TABLE `agent_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	`actor` text DEFAULT 'agent' NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text
);
