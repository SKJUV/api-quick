export interface DiffResult {
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: Array<{ key: string; oldValue: any; newValue: any }>;
  isIdentical: boolean;
}

export function compareJsonStructures(obj1: any, obj2: any, path = ""): DiffResult {
  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const modifiedKeys: Array<{ key: string; oldValue: any; newValue: any }> = [];

  if (typeof obj1 !== "object" || obj1 === null || typeof obj2 !== "object" || obj2 === null) {
    const isIdentical = obj1 === obj2;
    if (!isIdentical) {
      modifiedKeys.push({ key: path || "root", oldValue: obj1, newValue: obj2 });
    }
    return { addedKeys, removedKeys, modifiedKeys, isIdentical };
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  for (const k of keys1) {
    const currentPath = path ? `${path}.${k}` : k;
    if (!(k in obj2)) {
      removedKeys.push(currentPath);
    } else {
      const childDiff = compareJsonStructures(obj1[k], obj2[k], currentPath);
      addedKeys.push(...childDiff.addedKeys);
      removedKeys.push(...childDiff.removedKeys);
      modifiedKeys.push(...childDiff.modifiedKeys);
    }
  }

  for (const k of keys2) {
    const currentPath = path ? `${path}.${k}` : k;
    if (!(k in obj1)) {
      addedKeys.push(currentPath);
    }
  }

  const isIdentical = addedKeys.length === 0 && removedKeys.length === 0 && modifiedKeys.length === 0;

  return { addedKeys, removedKeys, modifiedKeys, isIdentical };
}
