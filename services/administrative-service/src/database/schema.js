module.exports = `
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  school_year INTEGER NOT NULL CHECK (school_year > 0),
  shift VARCHAR(20) NOT NULL CHECK (shift IN ('morning','afternoon','evening')),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, school_year)
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  workload_hours INTEGER NOT NULL CHECK (workload_hours > 0)
);

CREATE TABLE IF NOT EXISTS allocations (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL,
  room VARCHAR(80),
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 5),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS allocations_class_schedule_idx
  ON allocations(class_id, weekday);
CREATE INDEX IF NOT EXISTS allocations_teacher_schedule_idx
  ON allocations(teacher_id, weekday);
CREATE INDEX IF NOT EXISTS allocations_room_schedule_idx
  ON allocations(room, weekday);

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID UNIQUE NOT NULL,
  type TEXT NOT NULL,
  envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
