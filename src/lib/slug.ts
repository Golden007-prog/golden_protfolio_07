/**
 * Lower-kebab ASCII slug, the one slug rule for projects and skills.
 * 'Bruhworking — NexusFlow' -> 'bruhworking-nexusflow', 'CI/CD' -> 'ci-cd'.
 * Matches the rule that named the existing /public/skills images.
 */
export function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
