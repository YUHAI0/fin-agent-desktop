import os
import shutil
import subprocess
import sys
import argparse
from pathlib import Path

def get_current_version(version_file="VERSION"):
    """Read the current version from the VERSION file."""
    path = Path(version_file)
    if not path.exists():
        print(f"Error: {version_file} not found.")
        sys.exit(1)
    return path.read_text(encoding="utf-8").strip()

def clean_build_artifacts():
    """Clean up build artifacts."""
    print("Cleaning build artifacts...")
    patterns = ["dist", "build", "*.egg-info"]
    for pattern in patterns:
        for path in Path(".").glob(pattern):
            if path.is_dir():
                shutil.rmtree(path)
                print(f"Removed directory: {path}")
            else:
                os.remove(path)
                print(f"Removed file: {path}")

def increment_version(version_file="VERSION"):
    """Increment the patch version in VERSION file."""
    print("Updating version...")
    path = Path(version_file)
    
    current_version = get_current_version(version_file)
    
    try:
        parts = current_version.split('.')
        if len(parts) != 3:
            raise ValueError
        major, minor, patch = map(int, parts)
    except ValueError:
        print(f"Error: Invalid version format '{current_version}'. Expected 'x.y.z'.")
        sys.exit(1)
        
    new_patch = patch + 1
    new_version = f"{major}.{minor}.{new_patch}"
    
    path.write_text(new_version, encoding="utf-8")
    print(f"Bumped version from {current_version} to {new_version}")
    return new_version

def build_package():
    """Build the package."""
    print("Building package...")
    subprocess.check_call([sys.executable, "-m", "build"])

def upload_package(token):
    """Upload the package to PyPI."""
    print("Uploading to PyPI...")
    
    dist_files = [str(f) for f in Path("dist").glob("*")]
    if not dist_files:
        print("No distribution files found!")
        sys.exit(1)
        
    cmd = [
        sys.executable, "-m", "twine", "upload",
        "--username", "__token__",
        "--password", token
    ] + dist_files
    
    subprocess.check_call(cmd)

def main():
    parser = argparse.ArgumentParser(description="Build and publish fin-agent to PyPI.")
    parser.add_argument("-v", "--version", action="store_true", help="Show current version and exit.")
    args = parser.parse_args()

    if args.version:
        print(f"Current version: {get_current_version()}")
        sys.exit(0)

    token_file = Path(".pypitoken")
    if not token_file.exists():
        print("Error: .pypitoken file not found.")
        print("Please create a .pypitoken file containing your PyPI token.")
        sys.exit(1)

    token = token_file.read_text().strip()
    if not token:
        print("Error: .pypitoken file is empty.")
        sys.exit(1)

    try:
        clean_build_artifacts()
        increment_version()
        build_package()
        upload_package(token)
        print("\nSuccessfully published to PyPI!")
    except subprocess.CalledProcessError as e:
        print(f"\nError occurred: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nAn unexpected error occurred: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
