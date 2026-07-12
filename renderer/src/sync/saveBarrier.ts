type SaveParticipant = () => Promise<void>

const participants = new Set<SaveParticipant>()

export function registerSyncSaveParticipant(participant: SaveParticipant) {
  participants.add(participant)
  return () => {
    participants.delete(participant)
  }
}

export async function flushBeforeSync() {
  await Promise.all(Array.from(participants, (participant) => participant()))
}
