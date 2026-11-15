// Esquema SQL para inscrições, notas, médias, frequência e idempotência.
module.exports = `
CREATE TABLE IF NOT EXISTS academic_enrollments (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  academic_year VARCHAR(20) NOT NULL,
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id, academic_year)
);

CREATE INDEX IF NOT EXISTS academic_enrollments_course_status_idx
  ON academic_enrollments (course_id, status);
CREATE INDEX IF NOT EXISTS academic_enrollments_student_idx
  ON academic_enrollments (student_id);

CREATE TABLE IF NOT EXISTS academic_grades (
  id SERIAL PRIMARY KEY,
  enrollment_id INTEGER REFERENCES academic_enrollments(id) ON DELETE SET NULL,
  student_id INTEGER NOT NULL,
  course_id INTEGER,
  subject VARCHAR(120) NOT NULL,
  value NUMERIC(5, 2) NOT NULL CHECK (value >= 0 AND value <= 10),
  weight NUMERIC(8, 3) NOT NULL CHECK (weight > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academic_grades_average_idx
  ON academic_grades (student_id, subject);
CREATE INDEX IF NOT EXISTS academic_grades_enrollment_idx
  ON academic_grades (enrollment_id);

CREATE TABLE IF NOT EXISTS academic_averages (
  student_id INTEGER NOT NULL,
  subject VARCHAR(120) NOT NULL,
  average NUMERIC(7, 2) NOT NULL,
  total_weight NUMERIC(12, 3) NOT NULL,
  grade_count INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, subject)
);

CREATE TABLE IF NOT EXISTS academic_attendance (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL DEFAULT 0,
  attendance_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('present', 'absent', 'late', 'excused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS academic_attendance_summary_idx
  ON academic_attendance (student_id, course_id, status);
CREATE INDEX IF NOT EXISTS academic_attendance_date_idx
  ON academic_attendance (attendance_date);

CREATE TABLE IF NOT EXISTS academic_processed_events (
  event_id VARCHAR(200) PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID UNIQUE NOT NULL,
  type TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
