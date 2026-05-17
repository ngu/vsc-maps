import * as yaml from "js-yaml";

export function applyReplacementToRawText(rawText: string, path: string, value: unknown): string {
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new Error("Replacement path must be a non-empty string.");
  }

  const rootParsed = rawText.trim().length === 0 ? {} : yaml.load(rawText);

  if (!isRecord(rootParsed) && !Array.isArray(rootParsed)) {
    throw new Error("YAML root must be an object or array for path replacement.");
  }

  const tokens = parsePath(path);
  if (tokens.length === 0) {
    throw new Error("Path must contain at least one segment.");
  }

  const updatedRoot = setPathValue(rootParsed, tokens, value);
  return yaml.dump(updatedRoot, {
    noRefs: true,
    lineWidth: -1
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePath(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let index = 0;

  const skipWhitespace = (): void => {
    while (index < path.length && /\s/.test(path[index])) {
      index += 1;
    }
  };

  const readIdentifier = (): string => {
    const start = index;
    while (index < path.length && /[A-Za-z0-9_$-]/.test(path[index])) {
      index += 1;
    }
    return path.slice(start, index);
  };

  while (index < path.length) {
    skipWhitespace();

    if (index >= path.length) {
      break;
    }

    const char = path[index];

    if (char === ".") {
      index += 1;
      continue;
    }

    if (char === "[") {
      index += 1;
      skipWhitespace();

      if (index >= path.length) {
        throw new Error("Unclosed bracket in path.");
      }

      const quote = path[index];
      if (quote === '"' || quote === "'") {
        index += 1;
        const start = index;
        while (index < path.length && path[index] !== quote) {
          index += 1;
        }
        if (index >= path.length) {
          throw new Error("Unclosed quoted key in path.");
        }
        const key = path.slice(start, index);
        index += 1;
        skipWhitespace();
        if (path[index] !== "]") {
          throw new Error("Expected closing bracket after quoted key.");
        }
        index += 1;
        tokens.push(key);
        continue;
      }

      const start = index;
      while (index < path.length && path[index] !== "]") {
        index += 1;
      }
      if (index >= path.length) {
        throw new Error("Unclosed bracket in path.");
      }
      const rawSegment = path.slice(start, index).trim();
      index += 1;

      if (/^-?\d+$/.test(rawSegment)) {
        tokens.push(Number(rawSegment));
      } else if (rawSegment.length > 0) {
        tokens.push(rawSegment);
      } else {
        throw new Error("Empty bracket segment is not allowed.");
      }
      continue;
    }

    const identifier = readIdentifier();
    if (identifier.length === 0) {
      throw new Error(`Unexpected path token near index ${index}.`);
    }
    tokens.push(identifier);
  }

  return tokens;
}

function setPathValue(
  root: unknown,
  tokens: Array<string | number>,
  value: unknown
): unknown {
  let current = root;

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];

    if (typeof token === "number") {
      if (!Array.isArray(current)) {
        throw new Error(`Path segment ${String(token)} expects an array.`);
      }
      while (current.length <= token) {
        current.push(undefined);
      }
      if (current[token] === undefined || current[token] === null) {
        current[token] = typeof nextToken === "number" ? [] : {};
      }
      current = current[token];
      continue;
    }

    if (!isRecord(current)) {
      throw new Error(`Path segment ${token} expects an object.`);
    }

    if (current[token] === undefined || current[token] === null) {
      current[token] = typeof nextToken === "number" ? [] : {};
    }
    current = current[token];
  }

  const last = tokens[tokens.length - 1];
  if (typeof last === "number") {
    if (!Array.isArray(current)) {
      throw new Error(`Final path segment ${String(last)} expects an array.`);
    }
    while (current.length <= last) {
      current.push(undefined);
    }
    current[last] = value;
    return root;
  }

  if (!isRecord(current)) {
    throw new Error(`Final path segment ${last} expects an object.`);
  }

  current[last] = value;
  return root;
}