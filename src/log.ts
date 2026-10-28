export function logMutation(route: string, status: number, userId: string) {
  console.info(JSON.stringify({ route, status, user_id: userId }));
}
