# Turns a list of commit messages (oldest first) into one Discord post (max 2000 characters).
# Input: ["subject\n\n- bullet\n  continued\n\nCo-Authored-By: ...", ...]. Argument: $site.
# Commits with [skip notify] are left out; an empty result means: don't post.

def bullets: split("\n")[1:] | map(select(test("^(- |  )"))) | .[:12] | join("\n");
def block: (split("\n")[0]) as $subject | (bullets) as $b
  | "**" + $subject + "**" + (if $b == "" then "" else "\n" + $b end);

map(select(contains("[skip notify]") | not))
| if length == 0 then ""
  else
    (if length == 1 then "**Generator updated**\n" else "**Generator updated: \(length) changes**\n" end) as $head
    # Full blocks while they fit, then just the titles of the rest.
    | reduce .[] as $m ({text: "", rest: []};
        ($m | block) as $b
        | if (.rest | length) == 0 and ((.text | length) + ($b | length)) < 1500
          then .text += (if .text == "" then "" else "\n\n" end) + $b
          else .rest += [$m | split("\n")[0]] end)
    | ($head + .text + (if (.rest | length) > 0 then "\n\nAlso: " + (.rest | join(" · ")) else "" end)) as $body
    | (if ($body | length) > 1900 then $body[0:1900] + "…" else $body end) + "\n" + $site
  end
