const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAllocation } = require('../src/services/allocations.service');
const { validateClass } = require('../src/services/classes.service');
const { validateSubject } = require('../src/services/subjects.service');
const { BadRequestError } = require('../src/errors/AppError');
const schema = require('../src/database/schema');

const validAllocation = {
    class_id: 3,
    subject_id: 8,
    teacher_id: 12,
    room: null,
    weekday: 1,
    start_time: '09:00',
    end_time: '10:30'
};

test('accepts weekdays 1 and 5, nullable room, and derives year from the class', () => {
    const allocation = validateAllocation(validAllocation);
    assert.equal(allocation.start_time, '09:00:00');
    assert.equal(allocation.end_time, '10:30:00');
    assert.equal(allocation.weekday, 1);
    assert.equal(allocation.room, null);
    assert.equal(Object.hasOwn(allocation, 'school_year'), false);
    assert.equal(validateAllocation({ ...validAllocation, weekday: 5 }).weekday, 5);
    assert.equal(validateAllocation({ ...validAllocation, room: 'Room 4' }).room, 'Room 4');
});

test('rejects weekdays outside 1-5 and non-positive identifiers', () => {
    for (const weekday of [0, 6]) {
        assert.throws(
            () => validateAllocation({ ...validAllocation, weekday }),
            error => error instanceof BadRequestError && /weekday/.test(error.message)
        );
    }
    assert.throws(
        () => validateAllocation({ ...validAllocation, teacher_id: 0 }),
        error => error instanceof BadRequestError && /teacher_id/.test(error.message)
    );
});

test('requires a strictly positive interval', () => {
    assert.throws(
        () => validateAllocation({ ...validAllocation, start_time: '10:00', end_time: '10:00' }),
        error => error instanceof BadRequestError && /posterior/.test(error.message)
    );
});

test('validates class and subject payloads against their contract fields', () => {
    assert.deepEqual(validateClass({
        name: '6A',
        school_year: 2026,
        shift: 'morning',
        capacity: 30
    }), {
        name: '6A',
        school_year: 2026,
        shift: 'morning',
        capacity: 30
    });
    assert.equal(validateClass({
        name: '6A', school_year: 2026, shift: 'morning', capacity: 30, active: false
    }).active, false);
    assert.throws(
        () => validateClass({ name: '6A', school_year: 2026, shift: 'night', capacity: 30 }),
        error => error instanceof BadRequestError && /shift/.test(error.message)
    );
    assert.throws(
        () => validateClass({ name: '6A', school_year: 2026, shift: 'morning', capacity: 0 }),
        error => error instanceof BadRequestError && /capacity/.test(error.message)
    );
    assert.deepEqual(validateSubject({ name: 'Matemática', workload_hours: 80 }), {
        name: 'Matemática',
        workload_hours: 80
    });
});

test('schema uses class year for allocations and includes the required constraints', () => {
    assert.match(schema, /school_year INTEGER NOT NULL/);
    assert.match(schema, /shift IN \('morning','afternoon','evening'\)/);
    assert.match(schema, /capacity INTEGER NOT NULL CHECK \(capacity > 0\)/);
    assert.match(schema, /UNIQUE\(name, school_year\)/);
    assert.match(schema, /weekday BETWEEN 1 AND 5/);
    assert.match(schema, /room VARCHAR\(80\),/);
    assert.doesNotMatch(schema, /grade VARCHAR|school_year VARCHAR|code VARCHAR|description TEXT/);
    assert.doesNotMatch(schema.match(/CREATE TABLE IF NOT EXISTS allocations \([\s\S]*?\n\);/)[0], /school_year/);
});
