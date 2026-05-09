import bcrypt from "bcryptjs";

const hashRounds = 12;

export const hashSecret = async (secret: string): Promise<string> => {
  return bcrypt.hash(secret, hashRounds);
};

export const verifySecret = async (secret: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(secret, hash);
};
