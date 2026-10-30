from alembic import context
from db.engine import get_engine
from db.schema import metadata

if context.is_offline_mode():
    context.configure(dialect_name="mysql", target_metadata=metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with get_engine().connect() as connection:
        context.configure(connection=connection, target_metadata=metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
