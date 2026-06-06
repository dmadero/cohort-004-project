CREATE INDEX `enrollments_course_id_enrolled_at_idx` ON `enrollments` (`course_id`,`enrolled_at`);--> statement-breakpoint
CREATE INDEX `lesson_progress_lesson_id_status_idx` ON `lesson_progress` (`lesson_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchases_course_id_created_at_idx` ON `purchases` (`course_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quiz_attempts_quiz_id_user_id_attempted_at_idx` ON `quiz_attempts` (`quiz_id`,`user_id`,`attempted_at`);