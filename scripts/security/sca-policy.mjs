export function osvFindings(report) {
  if (!Array.isArray(report.results)) throw new Error('Invalid OSV report');
  if ((report.errors ?? []).length) throw new Error('Incomplete OSV scan');
  return report.results.flatMap(result => (result.packages ?? []).flatMap(entry =>
    (entry.groups ?? []).map(group => ({
      package: entry.package.name, version: entry.package.version,
      ids: [...group.ids].sort(), severity: group.max_severity,
      runtime: !(entry.dependency_groups ?? []).includes('dev'),
    }))));
}
export function compareFindings(head, base) {
  const key = f => JSON.stringify([f.package, f.version, f.ids]);
  const previous = new Set(base.map(key));
  const introduced = head.filter(f => !previous.has(key(f)));
  const critical = introduced.filter(f => Number(f.severity) >= 9);
  const high = introduced.filter(f => Number(f.severity) >= 7 && Number(f.severity) < 9);
  const unknown = introduced.filter(f => !f.severity || !Number.isFinite(Number(f.severity)));
  return { introduced, critical, high, unknown, preexisting: head.filter(f => previous.has(key(f))) };
}
