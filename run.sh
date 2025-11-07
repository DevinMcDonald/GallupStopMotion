#!/usr/bin/env bash

// activate python environment
source src/backend/.venv/bin/activate

procs=(
    "python3 server.py"
    "./start_camera.sh"
    "./other_task.sh"
)

pids=()

for cmd in "${procs[@]}"; do
    $cmd &
    pids+=($!)
done

cleanup() {
    echo "Stopping all processes..."
    kill "${pids[@]}" 2>/dev/null
    wait "${pids[@]}" 2>/dev/null
    exit 0
}

trap cleanup SIGINT

wait
