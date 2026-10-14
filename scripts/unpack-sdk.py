"""Inspect and extract the SDK produced by rules_pkg, rejecting unsafe members."""

import json
import pathlib
import sys
import tarfile

archive, destination = sys.argv[1:]
with tarfile.open(archive, "r:gz") as package:
    members = []
    total_size = 0
    seen = set()
    files = []
    for member in package:
        members.append(member)
        total_size += member.size
        if len(members) > 512 or total_size > 64 * 1024 * 1024:
            raise ValueError("SDK archive exceeds inspection limits")
        path = pathlib.PurePosixPath(member.name)
        if (path.is_absolute() or ".." in path.parts or not path.parts
                or path.parts[0] != "cf-0.1.0" or str(path) in seen):
            raise ValueError("Invalid or duplicate SDK archive path")
        seen.add(str(path))
        if not (member.isfile() or member.isdir()):
            raise ValueError("SDK archive must contain only files and directories")
        if member.uid != 0 or member.gid != 0 or member.mtime != 0:
            raise ValueError("SDK archive metadata is not normalized")
        if member.isfile():
            if member.mode != 0o644:
                raise ValueError("Unexpected SDK file permissions")
            files.append(str(path.relative_to("cf-0.1.0")))
    package.extractall(destination, members=members, filter="data")
print(json.dumps(sorted(files)))
