#!/usr/bin/env bash
# This script finds and kills the npm process that's running in shareplay folder

pids=$(ps -eF | awk '{if($0 ~ ".+\\snpm run dev.*") print $2}') 
if [[ -z $pids ]]; then
  exit
fi

for pid in $pids; do
  if [[ $(lsof -p $pid 2>/dev/null | awk '{if ($4=="cwd") print $9}') =~ "shareplay" ]]; then
    echo "Killing npm process ($pid) for shareplay"
    kill $pid
  fi
done
