#!/usr/bin/env python3
"""Read installed Python distribution metadata and check direct reverse constraints."""

import json
import re
import sys
from importlib import metadata

try:
    from packaging.requirements import Requirement
except ImportError:
    from pip._vendor.packaging.requirements import Requirement


def normalize(name):
    return re.sub(r"[-_.]+", "-", (name or "").strip().lower())


def audit(distributions, targets):
    result = {normalize(name): {"dependents": [], "indirect": [], "conflicts": [], "uncertain": []}
              for name in targets}
    reverse = {}
    installed = {}
    for dist in distributions:
        owner = dist.metadata.get("Name") or dist.name
        if not owner:
            continue
        version = dist.version
        installed[normalize(owner)] = {"name": owner, "version": version}
        for raw in dist.requires or []:
            try:
                req = Requirement(raw)
            except Exception:
                continue
            key = normalize(req.name)
            if normalize(owner) == key:
                continue
            edge = {"name": owner, "version": version, "requirement": raw}
            if req.marker:
                try:
                    if not req.marker.evaluate(environment={"extra": ""}):
                        if key in result and "extra" in str(req.marker):
                            result[key]["uncertain"].append({**edge, "reason": "可选 extra 是否启用无法从已装元数据确认"})
                        continue
                except Exception:
                    if key in result:
                        result[key]["uncertain"].append({**edge, "reason": "环境条件无法可靠求值"})
                    continue
            reverse.setdefault(key, set()).add(normalize(owner))
            if key not in result:
                continue
            result[key]["dependents"].append(edge)
            target = targets[key]
            if req.url:
                result[key]["uncertain"].append({**edge, "reason": "使用直接 URL 引用，无法用版本约束判断"})
                continue
            try:
                if req.specifier and not req.specifier.contains(target, prereleases=True):
                    result[key]["conflicts"].append(edge)
            except Exception:
                result[key]["uncertain"].append({**edge, "reason": "目标版本与约束无法比较"})
    for key, entry in result.items():
        direct = {normalize(item["name"]) for item in entry["dependents"]}
        seen = {key, *direct}
        queue = list(direct)
        while queue:
            current = queue.pop(0)
            for dependent in reverse.get(current, set()):
                if dependent in seen:
                    continue
                seen.add(dependent)
                queue.append(dependent)
                if dependent in installed:
                    entry["indirect"].append(installed[dependent])
        for field in ("dependents", "indirect", "conflicts", "uncertain"):
            deduplicated = {tuple(sorted(item.items())): item for item in entry[field]}
            entry[field] = sorted(deduplicated.values(), key=lambda item: (normalize(item["name"]), item.get("requirement", "")))
    return result


if __name__ == "__main__":
    requested = json.load(sys.stdin)
    targets = {normalize(name): version for name, version in requested.items()}
    print(json.dumps(audit(metadata.distributions(), targets), ensure_ascii=False))
