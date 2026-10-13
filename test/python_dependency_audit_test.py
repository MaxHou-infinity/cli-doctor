import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "bin" / "python_dependency_audit.py"
spec = importlib.util.spec_from_file_location("python_dependency_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def dist(name, version, requires=()):
    return SimpleNamespace(name=name, metadata={"Name": name}, version=version, requires=requires)


class DependencyAuditTest(unittest.TestCase):
    def test_conflicts_and_indirect_dependents(self):
        installed = [
            dist("libx", "1.5"),
            dist("AppA", "1.0", ["libx<2"]),
            dist("AppB", "1.0", ["libx>=1"]),
            dist("AppC", "1.0", ["AppA>=1"]),
        ]
        found = module.audit(installed, {"libx": "2.0"})["libx"]
        self.assertEqual([item["name"] for item in found["conflicts"]], ["AppA"])
        self.assertEqual([item["name"] for item in found["dependents"]], ["AppA", "AppB"])
        self.assertEqual([item["name"] for item in found["indirect"]], ["AppC"])

    def test_optional_extra_is_not_treated_as_active_constraint(self):
        installed = [dist("OptionalApp", "1.0", ['libx<2; extra == "feature"'])]
        found = module.audit(installed, {"libx": "2.0"})["libx"]
        self.assertEqual(found["conflicts"], [])
        self.assertEqual(found["dependents"], [])
        self.assertEqual([item["name"] for item in found["uncertain"]], ["OptionalApp"])


if __name__ == "__main__":
    unittest.main()
