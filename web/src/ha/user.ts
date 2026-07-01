import {
  getUser,
  type Connection,
  type HassUser,
} from "home-assistant-js-websocket";

export async function getCurrentUser(
  connection: Connection,
): Promise<HassUser> {
  return await getUser(connection);
}
