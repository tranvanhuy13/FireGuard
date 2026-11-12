"""Legacy ownership assignment is explicit, atomic and never transfers history."""
from unittest.mock import patch

import pytest
import sqlalchemy as sa

from db.engine import Connection
from db.schema import metadata
from scripts.assign_legacy_cameras import assign_legacy, parse_assignment


@pytest.fixture
def repository():
    engine = sa.create_engine('sqlite://')
    metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(metadata.tables['users'].insert(), [dict(id=2, username='legacy', role='user', is_active=1, is_blocked=0),
                                                       dict(id=3, username='other', role='user', is_active=1, is_blocked=0)])
        conn.execute(metadata.tables['cameras'].insert(), [dict(id=1,name='Old',source='0',created_at='now',is_active=1,owner_user_id=None),
                                                          dict(id=2,name='Owned',source='0',created_at='now',is_active=0,owner_user_id=3)])
        conn.execute(metadata.tables['events'].insert(), dict(id=1,timestamp='now',type='fire',confidence=.9))
    with patch('scripts.assign_legacy_cameras.get_connection', side_effect=lambda: Connection(engine.connect())), \
         patch.object(Connection, 'begin_serialized'):
        yield engine
    engine.dispose()


def row(engine, name, record_id=1):
    with engine.connect() as conn:
        table = metadata.tables[name]
        return conn.execute(sa.select(table).where(table.c.id==record_id)).mappings().one()


def test_dry_run_never_changes_legacy_data(repository):
    plan = assign_legacy([(1, 'legacy')])
    assert plan[0]['owner_user_id'] == 2
    assert row(repository,'cameras')['owner_user_id'] is None
    assert row(repository,'cameras')['is_active'] == 1


def test_apply_assigns_only_reviewed_camera_and_leaves_it_off(repository):
    assign_legacy([(1,'legacy')], apply=True)
    assert row(repository,'cameras')['owner_user_id'] == 2
    assert row(repository,'cameras')['is_active'] == 0
    assert row(repository,'cameras',2)['owner_user_id'] == 3
    assert row(repository,'events')['owner_user_id'] is None


@pytest.mark.parametrize('mapping', [[(1,'legacy'),(2,'legacy')], [(1,'missing')], [(1,'legacy'),(1,'other')]])
def test_invalid_mapping_rolls_back_every_change(repository,mapping):
    with pytest.raises(ValueError):
        assign_legacy(mapping,apply=True)
    assert row(repository,'cameras')['owner_user_id'] is None


def test_blocked_target_is_rejected(repository):
    with repository.begin() as conn:
        conn.execute(metadata.tables['users'].update().where(metadata.tables['users'].c.id==2).values(is_blocked=1))
    with pytest.raises(ValueError):
        assign_legacy([(1,'legacy')],apply=True)


def test_username_mapping_parser():
    assert parse_assignment('1:legacy') == (1,'legacy')
    for invalid in ('0:legacy','1:','legacy','-1:legacy'):
        with pytest.raises(Exception):
            parse_assignment(invalid)


def test_mid_apply_failure_rolls_back_earlier_camera(repository):
    with repository.begin() as conn:
        conn.execute(metadata.tables['cameras'].insert(), dict(id=3,name='Another old',source='0',created_at='now',is_active=0))
    original_execute = Connection.execute
    updates = 0

    def failing_execute(conn, sql, parameters=()):
        nonlocal updates
        if sql.startswith('UPDATE cameras'):
            updates += 1
            if updates == 2:
                raise RuntimeError('simulated write failure')
        return original_execute(conn, sql, parameters)

    with patch.object(Connection, 'execute', failing_execute):
        with pytest.raises(RuntimeError, match='simulated'):
            assign_legacy([(1,'legacy'),(3,'legacy')],apply=True)
    assert updates == 2
    assert row(repository,'cameras')['owner_user_id'] is None
    assert row(repository,'cameras',3)['owner_user_id'] is None
