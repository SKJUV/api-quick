export function generateShellCompletion(shell: "zsh" | "bash" | "fish"): string {
  if (shell === "zsh") {
    return `#compdef api-quick

_api_quick() {
  local -a commands options

  commands=(
    'tui:Launch full interactive Terminal UI workbench'
    'web:Launch Web UI with CORS bypass proxy'
    'mock:Launch zero-latency local AST mock API server'
    'diff:Visual structural JSON diffing engine'
    'sniff:Scan local source code AST for API routes'
    'bench:Run high-throughput HTTP load benchmark'
    'completion:Generate shell auto-completion script'
  )

  options=(
    '-X[Specify HTTP method]:method:(GET POST PUT DELETE PATCH HEAD OPTIONS)'
    '--method[Specify HTTP method]:method:(GET POST PUT DELETE PATCH HEAD OPTIONS)'
    '-H[Add custom header]:header:'
    '--header[Add custom header]:header:'
    '-b[Inject Bearer token]:token:'
    '--bearer[Inject Bearer token]:token:'
    '-u[Inject Basic Auth]:credentials:'
    '--auth[Inject Basic Auth]:credentials:'
    '-m[Timeout in ms]:timeout:'
    '--timeout[Timeout in ms]:timeout:'
    '--env[Set environment profile]:environment:'
    '--to[Transpile CLI request to target code]:language:(curl fetch-ts python go rust java csharp php)'
    '--expect-status[Assert HTTP status code]:status:'
    '--expect-max-time[Assert max response time]:time:'
    '--expect-header[Assert header]:header:'
    '--expect-json[Assert JSONPath value]:assertion:'
  )

  _arguments -s $options '*::command:_describe "command" commands'
}

_api_quick "$@"
`;
  }

  if (shell === "fish") {
    return `# fish completion for api-quick

complete -c api-quick -n "__fish_use_subcommand" -a "tui web mock diff sniff bench completion"
complete -c api-quick -l method -s X -r -a "GET POST PUT DELETE PATCH HEAD OPTIONS"
complete -c api-quick -l to -r -a "curl fetch-ts python go rust java csharp php"
complete -c api-quick -l expect-status -r
complete -c api-quick -l expect-max-time -r
complete -c api-quick -l env -r
`;
  }

  // Default Bash completion
  return `# bash completion for api-quick

_api_quick_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    --method|-X)
      COMPREPLY=( $(compgen -W "GET POST PUT DELETE PATCH HEAD OPTIONS" -- "$cur") )
      return 0
      ;;
    --to)
      COMPREPLY=( $(compgen -W "curl fetch-ts python go rust java csharp php" -- "$cur") )
      return 0
      ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "--method -X --header -H --bearer -b --auth -u --timeout -m --env --to --expect-status --expect-max-time --expect-header --expect-json" -- "$cur") )
    return 0
  fi

  COMPREPLY=( $(compgen -W "tui web mock diff sniff bench completion GET POST PUT DELETE PATCH" -- "$cur") )
}

complete -F _api_quick_completions api-quick
`;
}
