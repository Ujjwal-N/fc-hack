/** @jsxImportSource frog/jsx */

import { Button, Frog, TextInput } from "frog";
import { devtools } from "frog/dev";
// import { neynar } from 'frog/hubs'
import { handle } from "frog/next";
import { serveStatic } from "frog/serve-static";
import { getRedisClient } from "./redisClient";

import https from "https";
import { fetchQuery } from "@airstack/node";
import { init } from "@airstack/node";

init("1c40f289b453e44b7b3dbee3dd6884ac3");

type State = {
  fname: string;
  state: string;
  options: number;
};

const getQueryString = (fname: string) => `query MyQuery {
  TokenTransfers(
    input: {filter: {to: {_eq: "fc_fname:${fname}"}, type: {_eq: MINT}}, blockchain: base}
  ) {
    TokenTransfer {
      tokenAddress
      tokenNft {
        contentValue {
          image {
            medium
          }
        }
      }
      token {
        name
        lastTransferTimestamp
      }
    }
  }
}`;

const findFriends = async (fname: string, callback: (obj: any) => void) => {
  const options = {
    hostname: "graph.cast.k3l.io",
    port: 443, // HTTPS uses port 443 by default
    path: "/scores/personalized/engagement/handles?k=3&limit=20",
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
    },
  };

  const postData = JSON.stringify([fname]); // Array of usernames

  const req = https.request(options, async (res) => {
    res.on("data", async (d) => {
      const client = await getRedisClient();
      const jsonObject = JSON.parse(d).result;
      client.set(fname + ":friends", JSON.stringify(jsonObject));
      callback(jsonObject);
    });
  });
  req.write(postData);
  req.end();
};

const getNFTs = async (fname: string): Promise<[any]> => {
  const client = await getRedisClient();
  const data = await client.get(`${fname}:nfts`);
  if (data) {
    return JSON.parse(data);
  } else {
    const { data, error } = await fetchQuery(getQueryString(fname), {});
    const nftsArray = !error && data?.TokenTransfers?.TokenTransfer;
    if (nftsArray) {
      client.set(`${fname}:nfts`, JSON.stringify(nftsArray));
    }
    return nftsArray;
  }
};

const getFriendsData = async (fname: string) => {
  const client = await getRedisClient();
  const data = await client.get(fname + ":friends");
  if (data) {
    return JSON.parse(data);
  }
  return null;
};

const getTopFriends = (friendData: [any]) => {
  return friendData
    .slice(1, 6)
    .map((friend: any) => friend.fname)
    .join("\n");
};

const getAllAddresses = (friendData: [any]) =>
  friendData.map((friend: any) => friend.address).join("\n");

const app = new Frog<{ State: State }>({
  assetsPath: "/",
  basePath: "/api",
  initialState: {
    fname: "",
    state: "initial",
    options: 0,
  },
});

const currentDate = new Date();
const lastWeekDate = new Date(
  currentDate.getFullYear(),
  currentDate.getMonth(),
  currentDate.getDay() - 7,
  0,
  0,
  0,
  0
);

// Uncomment to use Edge Runtime
// export const runtime = 'edge'

app.frame("/", async (c) => {
  const { inputText, status, deriveState, buttonValue } = c;

  const intentOptions = [
    [
      <TextInput placeholder="Enter fname..." />,
      <Button value="submit">Submit</Button>,
    ],
    [<Button value="check">Check</Button>, <Button.Reset>Reset</Button.Reset>],
    [
      <Button value="viewNFTs">View NFTs</Button>,
      <Button.Reset>Reset</Button.Reset>,
    ],
    [<Button.Reset>Reset</Button.Reset>],
  ];

  let friends = "";
  let nfts = "NFTs";
  const state = await deriveState(async (previousState) => {
    if (
      previousState.state === "displayFriends" &&
      buttonValue === "viewNFTs"
    ) {
      previousState.state = "viewNFTs";
      previousState.options = 3;
    } else if (previousState.state === "loading" && buttonValue === "check") {
      const friendData = (await getFriendsData(previousState.fname)) || "";
      if (friendData) {
        friends = getTopFriends(friendData);
        previousState.state = "displayFriends";
        previousState.options = 2;
      }
    } else if (previousState.state === "initial" && inputText !== "") {
      previousState.fname = inputText || "";
      previousState.state = "loading";
      previousState.options = 1;
    } else {
      previousState.state = "initial";
      previousState.options = 0;
    }
  });
  const client = await getRedisClient();
  if (state.state === "loading") {
    findFriends(state.fname, async (data) => {
      const allFnames = data
        .map((friend: any) => friend.fname)
        .filter((data: any) => data !== state.fname);
      const nftToHolders = new Map();
      const nftToData = new Map();
      for (const fname of allFnames) {
        const otherNFTs = (await getNFTs(fname)) || [];

        otherNFTs
          .filter((obj) => {
            const tsString = obj.token?.lastTransferTimestamp;
            return tsString && new Date(tsString) > lastWeekDate;
          })
          .forEach((obj) => {
            const { tokenAddress } = obj;
            //console.log(tokenAddress);
            nftToHolders.set(
              tokenAddress,
              (nftToHolders.get(tokenAddress) || 0) + 1
            );
            if (!nftToData.has(tokenAddress)) {
              nftToData.set(tokenAddress, obj);
            }
          });
      }
      const sortedEntries = Array.from(nftToHolders.entries())
        .filter((arr) => arr[1] >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map((arr) => {
          const addr = arr[0];
          const obj = nftToData.get(addr);
          return {
            tokenAddress: addr,
            image: obj?.tokenNft?.contentValue?.image?.medium,
            name: obj?.token?.name,
          };
        });

      client.set(`${state.fname}:topNFTs`, JSON.stringify(sortedEntries));
    });
  } else if (state.state === "viewNFTs") {
    const res = await client.get(`${state.fname}:topNFTs`);
    if (res) {
      const arr = JSON.parse(res);
      nfts = arr.map((obj: any) => `${obj.name}`).join("\n");
    }
  }

  return c.res({
    image: (
      <div
        style={{
          alignItems: "center",
          background:
            status === "response"
              ? "linear-gradient(to right, #432889, #17101F)"
              : "black",
          backgroundSize: "100% 100%",
          display: "flex",
          flexDirection: "column",
          flexWrap: "nowrap",
          height: "100%",
          justifyContent: "center",
          textAlign: "center",
          width: "100%",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 20,
            fontStyle: "normal",
            letterSpacing: "-0.025em",
            lineHeight: 1.4,
            marginTop: 30,
            padding: "0 120px",
            whiteSpace: "pre-wrap",
          }}
        >
          {status === "response"
            ? state.state === "loading"
              ? `Loading... with fname ${state.fname}`
              : state.state === "displayFriends"
              ? friends
              : nfts
            : "Welcome!"}
        </div>
      </div>
    ),
    intents: intentOptions[status === "response" ? state.options : 0],
  });
});

devtools(app, { serveStatic });

export const GET = handle(app);
export const POST = handle(app);
