import { Request, Response } from "express";
import { loginUser, registerUser } from "./auth.service.js";

export async function register(req: Request, res: Response) {
  try {
    const result = await registerUser(req.body);

    if (!result.success) {
  return res.status(409).json({
    message: result.message,
  });
}

return res.status(201).json(result.user);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
}

export async function login(req: Request, res: Response) {

  try {

    const result = await loginUser(req.body);

    if (!result.success) {

      return res.status(401).json({

        message: result.message,

      });

    }

    return res.status(200).json(result.user);

  } catch (error) {

    console.error(error);

    return res.status(500).json({

      message: "Internal Server Error",

    });

  }

}