#!/bin/sh
# Build the PostgreSQL 17 client tools missing from the small embedded-server package.
set -eu
monitor_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
monitor_data="$monitor_root/.data"
monitor_version=17.10
monitor_prefix="$monitor_data/postgres-tools"
if [ -x "$monitor_prefix/bin/pg_dump" ] && [ -x "$monitor_prefix/bin/pg_restore" ]; then exit 0; fi
mkdir -p "$monitor_data"
monitor_archive="$monitor_data/postgresql-tools.tar.bz2"
monitor_url="https://ftp.postgresql.org/pub/source/v$monitor_version/postgresql-$monitor_version.tar.bz2"
if [ ! -f "$monitor_archive" ]; then curl --fail --location --max-time 300 -o "$monitor_archive" "$monitor_url"; fi
curl --fail --location --max-time 30 -o "$monitor_data/postgresql-tools.sha256" "$monitor_url.sha256"
monitor_expected=$(awk '{print $1}' "$monitor_data/postgresql-tools.sha256")
monitor_actual=$(shasum -a 256 "$monitor_archive" | awk '{print $1}')
if [ "$monitor_actual" != "$monitor_expected" ]; then echo 'PostgreSQL source checksum mismatch' >&2; exit 1; fi
if [ ! -d "$monitor_data/postgresql-$monitor_version" ]; then tar -xjf "$monitor_archive" -C "$monitor_data"; fi
cd "$monitor_data/postgresql-$monitor_version"
if [ -n "${MONITOR_SDKROOT:-}" ]; then SDKROOT="$MONITOR_SDKROOT"; export SDKROOT
elif [ -d /Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk ]; then SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk; export SDKROOT; fi
./configure --prefix="$monitor_prefix" --without-icu --without-readline --without-lz4 --without-zstd > "$monitor_data/postgres-configure.log" 2>&1
make -j4 > "$monitor_data/postgres-make.log" 2>&1
make -C src/interfaces/libpq install > "$monitor_data/postgres-install.log" 2>&1
make -C src/bin/pg_dump install >> "$monitor_data/postgres-install.log" 2>&1
"$monitor_prefix/bin/pg_dump" --version
