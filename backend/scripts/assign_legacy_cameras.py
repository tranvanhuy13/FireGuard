"""Review and explicitly assign unowned legacy cameras. Dry-run by default.

python -m scripts.assign_legacy_cameras
python -m scripts.assign_legacy_cameras --assign 1:verified_username
python -m scripts.assign_legacy_cameras --assign 1:verified_username --apply
"""
import argparse
import json

from db.engine import get_connection


def parse_assignment(value):
    camera, separator, username = value.partition(':')
    if not separator or not camera.isdigit() or int(camera) < 1 or not username.strip():
        raise argparse.ArgumentTypeError('Expected positive CAMERA_ID:USERNAME')
    return int(camera), username.strip()


def plan_assignments(conn, assignments):
    plan, seen = [], set()
    for camera_id, username in assignments:
        if camera_id in seen:
            raise ValueError(f'Duplicate camera ID: {camera_id}')
        seen.add(camera_id)
        user = conn.execute('SELECT id,username,role,is_active,is_blocked FROM users WHERE username=?',
                            (username,)).fetchone()
        if user is None or not user['is_active'] or user['is_blocked'] or user['role'] not in ('user', 'admin'):
            raise ValueError(f'Target account must be active and unblocked: {username}')
        camera = conn.execute('SELECT id,name,owner_user_id,is_active FROM cameras WHERE id=?', (camera_id,)).fetchone()
        if camera is None:
            raise ValueError(f'Camera not found: {camera_id}')
        if camera['owner_user_id'] is not None:
            raise ValueError(f'Camera already has an owner: {camera_id}')
        plan.append(dict(camera_id=camera_id, camera_name=camera['name'],
                         owner_user_id=user['id'], owner_username=user['username'], is_active=False))
    return plan


def assign_legacy(assignments, apply=False):
    with get_connection() as conn:
        if apply:
            conn.begin_serialized()
        plan = plan_assignments(conn, assignments)
        if apply:
            for item in plan:
                result = conn.execute('UPDATE cameras SET owner_user_id=?,is_active=0 WHERE id=? AND owner_user_id IS NULL',
                                      (item['owner_user_id'], item['camera_id']))
                if result.rowcount != 1:
                    raise ValueError(f'Camera ownership changed concurrently: {item["camera_id"]}')
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assign', type=parse_assignment, action='append', default=[])
    parser.add_argument('--apply', action='store_true', help='Commit the reviewed explicit mapping; cameras stay OFF')
    args = parser.parse_args()
    if not args.assign:
        if args.apply:
            parser.error('--apply requires at least one explicit --assign mapping')
        with get_connection() as conn:
            legacy = [dict(row) for row in conn.execute(
                'SELECT id,name,is_active FROM cameras WHERE owner_user_id IS NULL ORDER BY id').fetchall()]
        print(json.dumps({'unassigned_cameras': legacy}, ensure_ascii=False, indent=2))
        return
    try:
        plan = assign_legacy(args.assign, args.apply)
    except ValueError as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps({'applied': args.apply, 'assignments': plan}, ensure_ascii=False, indent=2))
    if args.apply:
        print('Restart every backend connected to this database. Historical events and images were not reassigned.')


if __name__ == '__main__':
    main()
