export const MANAGED_TRASH_DIRECTORY = ".sshelf-trash"

export function isManagedTrashPath(path: string): boolean {
  const prefix = `${MANAGED_TRASH_DIRECTORY}/`
  if (!path.startsWith(prefix)) return false
  const itemName = path.slice(prefix.length)
  return itemName.length > 0 && !itemName.includes("/")
}
