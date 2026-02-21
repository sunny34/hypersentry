import sys

def check_balance(file_path):
    with open(file_path, 'r') as f:
        content = f.read()

    stack = []
    lines = content.split('\n')
    for i, line in enumerate(lines):
        for j, char in enumerate(line):
            if char in "({[":
                stack.append((char, i+1, j+1))
            elif char in ")}]":
                if not stack:
                    print(f"Unmatched closing {char} at line {i+1} col {j+1}")
                    return
                last, l_i, l_j = stack.pop()
                expected = {'(': ')', '{': '}', '[': ']'}[last]
                if char != expected:
                    print(f"Mismatched! Expected {expected} for {last} from line {l_i} col {l_j}, but found {char} at line {i+1} col {j+1}")
                    return

    if stack:
        print("Unclosed brackets:")
        for char, l_i, l_j in stack:
            print(f"  {char} at line {l_i} col {l_j}")
    else:
        print("All brackets balanced! (Ignoring strings/comments though...)")

check_balance('app/terminal/page.tsx')
