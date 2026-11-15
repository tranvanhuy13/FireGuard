"""Read actual route definitions for isolated AST checks without starting services."""
import ast
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def application_source():
    paths = [BACKEND_DIR / "app/bootstrap.py", BACKEND_DIR / "app/videos/schemas.py"]
    paths += sorted((BACKEND_DIR / "app").rglob("*routes.py"))
    paths += sorted((BACKEND_DIR / "app").rglob("streaming.py"))
    nodes = []
    for path in paths:
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        for node in tree.body:
            if getattr(node, "name", None) == "create_app":
                nodes.extend(node.body)
            else:
                nodes.append(node)

    class Isolate(ast.NodeTransformer):
        def visit_Attribute(self, node):
            if isinstance(node.value, ast.Name) and node.value.id == "runtime":
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
            return self.generic_visit(node)

        def visit_Name(self, node):
            if node.id == "router":
                return ast.copy_location(ast.Name(id="app", ctx=node.ctx), node)
            return node

    tree = Isolate().visit(ast.Module(body=nodes, type_ignores=[]))
    return ast.unparse(ast.fix_missing_locations(tree))
