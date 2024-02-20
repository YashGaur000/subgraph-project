import {
  PoolContract_Fees_loader,
  PoolContract_Fees_handler,
  PoolContract_Sync_loader,
  PoolContract_Sync_handler,
  PoolContract_Swap_loader,
  PoolContract_Swap_handler,
  PoolFactoryContract_PoolCreated_loader,
  PoolFactoryContract_PoolCreated_handlerAsync,
  VoterContract_DistributeReward_loader,
  VoterContract_DistributeReward_handler,
  VoterContract_GaugeCreated_loader,
  VoterContract_GaugeCreated_handler,
  VotingRewardContract_NotifyReward_loader,
  VotingRewardContract_NotifyReward_handler,
} from "../generated/src/Handlers.gen";

import {
  LatestETHPriceEntity,
  LiquidityPoolEntity,
  TokenEntity,
  LiquidityPoolNewEntity,
  LatestPriceEntity,
} from "./src/Types.gen";

import {
  DEFAULT_STATE_STORE,
  INITIAL_ETH_PRICE,
  STATE_STORE_ID,
  CHAIN_CONSTANTS,
  PRICING_POOLS,
  USD_TOKENS_ADDRESSES,
  TOKENS_PRICED_IN_USD_ADDRESSES,
  PRICING_POOLS_ADDRESSES,
  TEN_TO_THE_18_BI,
} from "./Constants";

import {
  // calculateETHPriceInUSD,
  // isStablecoinPool,
  normalizeTokenAmountTo1e18,
  // getLiquidityPoolAndUserMappingId,
  generatePoolName,
  findPricePerETH,
  trimRelevantLiquidityPoolEntities,
  trimAfterDashAndLowercase,
  absBigInt,
} from "./Helpers";

import { divideBase1e18, multiplyBase1e18 } from "./Maths";

import {
  getLiquidityPoolSnapshotByInterval,
  getTokenSnapshotByInterval,
} from "./IntervalSnapshots";

import { SnapshotInterval, TokenEntityMapping } from "./CustomTypes";

import { poolLookupStoreManager, whitelistedPoolIdsManager } from "./Store";

import { getErc20TokenDetails } from "./Erc20";

//// global state!
const {
  getPoolAddressByGaugeAddress,
  getPoolAddressByBribeVotingRewardAddress,
  addRewardAddressDetails,
} = poolLookupStoreManager();
const {
  addWhitelistedPoolId,
  getWhitelistedPoolIds,
  getTokensFromWhitelistedPool,
} = whitelistedPoolIdsManager();

PoolFactoryContract_PoolCreated_loader(({ event, context }) => {
  // // Dynamic contract registration for Pool contracts
  // context.contractRegistration.addPool(event.params.pool);

  // load the global state store
  context.StateStore.stateStoreLoad(STATE_STORE_ID, {
    loaders: {},
  });

  // load the token entities
  context.Token.poolTokensLoad([
    event.params.token0 + "-" + event.chainId.toString(),
    event.params.token1 + "-" + event.chainId.toString(),
  ]);
});

PoolFactoryContract_PoolCreated_handlerAsync(async ({ event, context }) => {
  // Retrieve the global state store
  let stateStore = await context.StateStore.stateStore;

  if (!stateStore) {
    context.LatestETHPrice.set(INITIAL_ETH_PRICE);
    context.StateStore.set(DEFAULT_STATE_STORE);
  }

  // Retrieve the token entities - they might be undefined at this point
  let poolTokens = await context.Token.poolTokens;

  // Create an array to store the token symbols for pool naming later
  let poolTokenSymbols: string[] = [];

  // Create a mapping of poolToken to its address
  let poolTokenAddressMappings: TokenEntityMapping[] = [
    { address: event.params.token0, tokenInstance: poolTokens[0] },
    { address: event.params.token1, tokenInstance: poolTokens[1] },
  ];

  // Iterating over each token
  for (let poolTokenAddressMapping of poolTokenAddressMappings) {
    if (poolTokenAddressMapping.tokenInstance == undefined) {
      // If token entity is undefined, then make the async calls and create token entity
      const {
        name: tokenName,
        decimals: tokenDecimals,
        symbol: tokenSymbol,
      } = await getErc20TokenDetails(
        poolTokenAddressMapping.address,
        event.chainId
      );

      // Create new instances of TokenEntity to be updated in the DB
      const tokenInstance: TokenEntity = {
        id: poolTokenAddressMapping.address + "-" + event.chainId.toString(),
        symbol: tokenSymbol,
        name: tokenName,
        decimals: BigInt(tokenDecimals),
        chainID: BigInt(event.chainId),
        pricePerETH: 0n,
        pricePerUSD: 0n,
        pricePerUSDNew: 0n,
        lastUpdatedTimestamp: BigInt(event.blockTimestamp),
      };

      // Update the TokenEntity in the DB
      context.Token.set(tokenInstance);

      // Push the token symbol to the poolTokenSymbols array
      poolTokenSymbols.push(tokenSymbol);
    } else {
      // If token entity exists, then push the token symbol to the poolTokenSymbols array
      poolTokenSymbols.push(poolTokenAddressMapping.tokenInstance.symbol);
    }
  }

  // Create a new instance of LiquidityPoolEntity to be updated in the DB
  const newPool: LiquidityPoolEntity = {
    id: event.params.pool.toString(),
    chainID: BigInt(event.chainId),
    name: generatePoolName(
      poolTokenSymbols[0],
      poolTokenSymbols[1],
      event.params.stable
    ),
    token0: event.params.token0 + "-" + event.chainId.toString(),
    token1: event.params.token1 + "-" + event.chainId.toString(),
    isStable: event.params.stable,
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidityETH: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    totalFeesUSD: 0n,
    numberOfSwaps: 0n,
    token0Price: 0n,
    token1Price: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    lastUpdatedTimestamp: BigInt(event.blockTimestamp),
  };

  // Create the LiquidityPoolEntity in the DB
  context.LiquidityPool.set(newPool);

  // Create a new instance of LiquidityPoolEntity to be updated in the DB
  const pool: LiquidityPoolNewEntity = {
    id: event.params.pool.toString(),
    chainID: BigInt(event.chainId),
    name: generatePoolName(
      poolTokenSymbols[0],
      poolTokenSymbols[1],
      event.params.stable
    ),
    token0: event.params.token0 + "-" + event.chainId.toString(),
    token1: event.params.token1 + "-" + event.chainId.toString(),
    isStable: event.params.stable,
    reserve0: 0n,
    reserve1: 0n,
    totalLiquidityETH: 0n,
    totalLiquidityUSD: 0n,
    totalVolume0: 0n,
    totalVolume1: 0n,
    totalVolumeUSD: 0n,
    totalFees0: 0n,
    totalFees1: 0n,
    totalFeesUSD: 0n,
    numberOfSwaps: 0n,
    token0Price: 0n,
    token1Price: 0n,
    totalEmissions: 0n,
    totalEmissionsUSD: 0n,
    totalBribesUSD: 0n,
    lastUpdatedTimestamp: BigInt(event.blockTimestamp),
  };

  // Create the LiquidityPoolEntity in the DB
  context.LiquidityPoolNew.set(pool);

  // Push the pool that was created to the poolsWithWhitelistedTokens list if the pool contains at least one whitelisted token
  if (
    CHAIN_CONSTANTS[event.chainId].whitelistedTokenAddresses.includes(
      event.params.token0
    ) ||
    CHAIN_CONSTANTS[event.chainId].whitelistedTokenAddresses.includes(
      event.params.token1
    )
  ) {
    // push pool address to whitelistedPoolIds
    addWhitelistedPoolId(
      event.chainId,
      event.params.token0,
      event.params.token1,
      newPool.id
    );
  }
});

PoolContract_Fees_loader(({ event, context }) => {
  //Load the single liquidity pool from the loader to be updated
  context.LiquidityPool.load(event.srcAddress.toString(), {
    loaders: {
      loadToken0: true,
      loadToken1: true,
    },
  });
});

PoolContract_Fees_handler(({ event, context }) => {
  // Fetch the current liquidity pool from the loader
  let currentLiquidityPool = context.LiquidityPool.get(
    event.srcAddress.toString()
  );

  // The pool entity should be created via PoolCreated event from the PoolFactory contract
  if (currentLiquidityPool) {
    // Get the tokens from the loader and update their pricing
    let token0Instance = context.LiquidityPool.getToken0(currentLiquidityPool);

    let token1Instance = context.LiquidityPool.getToken1(currentLiquidityPool);

    // Normalize swap amounts to 1e18
    let normalizedFeeAmount0Total = normalizeTokenAmountTo1e18(
      event.params.amount0,
      Number(token0Instance.decimals)
    );
    let normalizedFeeAmount1Total = normalizeTokenAmountTo1e18(
      event.params.amount1,
      Number(token1Instance.decimals)
    );

    // Calculate amounts in USD
    let normalizedFeeAmount0TotalUsd = multiplyBase1e18(
      normalizedFeeAmount0Total,
      token0Instance.pricePerUSD
    );
    let normalizedFeeAmount1TotalUsd = multiplyBase1e18(
      normalizedFeeAmount1Total,
      token1Instance.pricePerUSD
    );
    // Create a new instance of LiquidityPoolEntity to be updated in the DB
    const liquidityPoolInstance: LiquidityPoolEntity = {
      ...currentLiquidityPool,
      totalFees0: currentLiquidityPool.totalFees0 + normalizedFeeAmount0Total,
      totalFees1: currentLiquidityPool.totalFees1 + normalizedFeeAmount1Total,
      totalFeesUSD:
        currentLiquidityPool.totalFeesUSD +
        normalizedFeeAmount0TotalUsd +
        normalizedFeeAmount1TotalUsd,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };
    // Update the LiquidityPoolEntity in the DB
    context.LiquidityPool.set(liquidityPoolInstance);
  } else {
    context.log.error(
      `Fees event recieved for liquidity pool that is not registered ${event.srcAddress.toString()}`
    );
  }
});

PoolContract_Swap_loader(({ event, context }) => {
  //Load the single liquidity pool from the loader to be updated
  context.LiquidityPool.load(event.srcAddress.toString(), {
    loaders: {
      loadToken0: true,
      loadToken1: true,
    },
  });

  context.LiquidityPoolNew.load(event.srcAddress.toString(), {});

  //Load the mapping for liquidity pool and the user
  //   context.LiquidityPoolUserMapping.poolUserMappingLoad(
  //     getLiquidityPoolAndUserMappingId(
  //       event.srcAddress.toString(),
  //       event.params.to.toString()
  //     ),
  //     {}
  //   );

  //   //Load the user entity
  //   context.User.userLoad(event.params.to.toString());
});

PoolContract_Swap_handler(({ event, context }) => {
  // Fetch the current liquidity pool from the loader
  let currentLiquidityPool = context.LiquidityPool.get(
    event.srcAddress.toString()
  );

  let liquidityPoolNew = context.LiquidityPoolNew.get(
    event.srcAddress.toString()
  );

  // Fetching the relevant liquidity pool user mapping
  // const liquidityPoolUserMapping =
  //   context.LiquidityPoolUserMapping.poolUserMapping;

  // // If the mapping doesn't exist yet, create the mapping and save in DB
  // if (!liquidityPoolUserMapping) {
  //   let newLiquidityPoolUserMapping: LiquidityPoolUserMappingEntity = {
  //     id: getLiquidityPoolAndUserMappingId(
  //       event.srcAddress.toString(),
  //       event.params.to.toString()
  //     ),
  //     liquidityPool: event.srcAddress.toString(),
  //     user: event.params.to.toString(),
  //   };

  //   context.LiquidityPoolUserMapping.set(newLiquidityPoolUserMapping);
  // }

  // Fetching the relevant user entity
  // let currentUser = context.User.user;

  // The pool entity should be created via PoolCreated event from the PoolFactory contract
  if (currentLiquidityPool) {
    // Get the tokens from the loader and update their pricing
    let token0Instance = context.LiquidityPool.getToken0(currentLiquidityPool);

    let token1Instance = context.LiquidityPool.getToken1(currentLiquidityPool);

    // Normalize swap amounts to 1e18
    let normalizedAmount0Total = normalizeTokenAmountTo1e18(
      event.params.amount0In + event.params.amount0Out,
      Number(token0Instance.decimals)
    );
    let normalizedAmount1Total = normalizeTokenAmountTo1e18(
      event.params.amount1In + event.params.amount1Out,
      Number(token1Instance.decimals)
    );

    // Same as above.
    // Important assume if amount0In is >0 then amount0Out =0 etc
    let netAmount0 = normalizeTokenAmountTo1e18(
      event.params.amount0In + event.params.amount0Out,
      Number(token0Instance.decimals)
    );
    let netAmount1 = normalizeTokenAmountTo1e18(
      event.params.amount1In + event.params.amount1Out,
      Number(token1Instance.decimals)
    );

    let token0Price = 0n;
    let token1Price = 0n;
    if (netAmount0 != 0n && netAmount1 != 0n) {
      token0Price = divideBase1e18(netAmount1, netAmount0);
      token1Price = divideBase1e18(netAmount0, netAmount1);
    }

    if (liquidityPoolNew) {
      // Work out relative token pricing base on swaps above.
      const liquidityPoolInstanceNew: LiquidityPoolNewEntity = {
        ...liquidityPoolNew,
        token0Price: liquidityPoolNew.isStable
          ? token0Price
          : liquidityPoolNew.token0Price,
        token1Price: liquidityPoolNew.isStable
          ? token1Price
          : liquidityPoolNew.token1Price,
        numberOfSwaps: currentLiquidityPool.numberOfSwaps + 1n,
        lastUpdatedTimestamp: BigInt(event.blockTimestamp),
      };

      context.LiquidityPoolNew.set(liquidityPoolInstanceNew);
    }

    // Calculate amounts in USD
    let normalizedAmount0TotalUsd = multiplyBase1e18(
      normalizedAmount0Total,
      token0Instance.pricePerUSD
    );
    let normalizedAmount1TotalUsd = multiplyBase1e18(
      normalizedAmount1Total,
      token1Instance.pricePerUSD
    );

    // Get the user id from the loader or initialize it from the event if user doesn't exist
    // let existingUserId = currentUser
    //   ? currentUser.id
    //   : event.params.to.toString();
    // let existingUserVolume = currentUser ? currentUser.totalSwapVolumeUSD : 0n;
    // let existingUserNumberOfSwaps = currentUser
    //   ? currentUser.numberOfSwaps
    //   : 0n;

    // // Create a new instance of UserEntity to be updated in the DB
    // const userInstance: UserEntity = {
    //   id: existingUserId,
    //   totalSwapVolumeUSD:
    //     existingUserVolume +
    //     normalizedAmount0TotalUsd +
    //     normalizedAmount1TotalUsd,
    //   numberOfSwaps: existingUserNumberOfSwaps + 1n,
    //   lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    // };

    // Create a new instance of LiquidityPoolEntity to be updated in the DB
    const liquidityPoolInstance: LiquidityPoolEntity = {
      ...currentLiquidityPool,
      totalVolume0: currentLiquidityPool.totalVolume0 + normalizedAmount0Total,
      totalVolume1: currentLiquidityPool.totalVolume1 + normalizedAmount1Total,
      totalVolumeUSD:
        currentLiquidityPool.totalVolumeUSD +
        normalizedAmount0TotalUsd +
        normalizedAmount1TotalUsd,
      numberOfSwaps: currentLiquidityPool.numberOfSwaps + 1n,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };

    // Update the LiquidityPoolEntity in the DB
    context.LiquidityPool.set(liquidityPoolInstance);

    // Update the UserEntity in the DB
    // context.User.set(userInstance);
  }
});

PoolContract_Sync_loader(({ event, context }) => {
  // if (PRICING_POOLS_ADDRESSES.includes(event.srcAddress.toString())) {
  //   // push pool address to whitelistedPoolIds
  //   context.LatestPrice.load(event.srcAddress.toString());
  // }
  // only need to load if its a price related update.
  context.LiquidityPoolNew.load(event.srcAddress.toString(), {});

  // load the global state store
  // context.StateStore.stateStoreLoad(STATE_STORE_ID, {
  //   loaders: { loadLatestEthPrice: true },
  // });

  // Load the single liquidity pool from the loader to be updated
  context.LiquidityPool.singlePoolLoad(event.srcAddress.toString(), {
    loaders: {
      loadToken0: true,
      loadToken1: true,
    },
  });

  // if the pool is whitelisted, which means at least of the tokens are whitelisted, it loads both tokens, token 0 an token 1
  // token 0 and token 1 could either be whitelisted or not but at least one of them is whitelisted.
  // const maybeTokensWhitelisted = getTokensFromWhitelistedPool(
  //   event.chainId,
  //   event.srcAddress.toString()
  // );
  // // temp optimization, if a token is WETH or USDC, skip loading all whitelisted pools as its not used in very expensive findPricePerETH function.
  // if (maybeTokensWhitelisted) {
  //   let wethAddress = CHAIN_CONSTANTS[event.chainId].eth.address.toLowerCase();
  //   let usdcAddress = CHAIN_CONSTANTS[event.chainId].usdc.address.toLowerCase();
  //   if (
  //     maybeTokensWhitelisted.token0.toLowerCase() == wethAddress ||
  //     maybeTokensWhitelisted.token1.toLowerCase() == wethAddress ||
  //     maybeTokensWhitelisted.token0.toLowerCase() == usdcAddress ||
  //     maybeTokensWhitelisted.token1.toLowerCase() == usdcAddress
  //   ) {
  //     context.LiquidityPool.whitelistedPools0Load([], {});
  //     context.LiquidityPool.whitelistedPools1Load([], {});
  //   } else {
  //     // only do all this crazy loading if necessary!!

  //     // Load all the whitelisted pools i.e. pools with at least one white listed tokens
  //     // only load here if tokens are in whitelisted pool.
  //     // i.e. if VELO is whitelisted token, then all pools with VELO are whitelisted pools and loaded here.
  //     // Even something like RED/VELO with 0 liquidity
  //     // i.e. all the pools containing token0 (if token 0 is whitelisted)

  //     context.LiquidityPool.whitelistedPools0Load(
  //       getWhitelistedPoolIds(event.chainId, maybeTokensWhitelisted.token0),
  //       {}
  //     );

  //     context.LiquidityPool.whitelistedPools1Load(
  //       getWhitelistedPoolIds(event.chainId, maybeTokensWhitelisted.token1),
  //       {}
  //     );
  //   }
  // } else {
  //   context.LiquidityPool.whitelistedPools0Load([], {});
  //   context.LiquidityPool.whitelistedPools1Load([], {});
  // }

  // // Load all the whitelisted tokens to be potentially used in pricing
  // // shift this to only load if token0 or token1 is whitelisted
  // context.Token.whitelistedTokensLoad(
  //   CHAIN_CONSTANTS[event.chainId].whitelistedTokenAddresses
  // );
});

PoolContract_Sync_handler(({ event, context }) => {
  // Fetch the state store from the loader
  // const { stateStore } = context.StateStore;
  // if (!stateStore) {
  //   throw new Error(
  //     "Critical bug: stateStore is undefined. Make sure it is defined on pool creation."
  //   );
  // }

  // Fetch the current liquidity pool from the loader
  let currentLiquidityPool = context.LiquidityPool.singlePool;

  // Get a list of all the whitelisted token entities
  // let whitelistedTokensList = context.Token.whitelistedTokens.filter(
  //   (item) => !!item
  // ) as TokenEntity[];

  // Get the LatestETHPrice object
  // let latestEthPrice = context.StateStore.getLatestEthPrice(stateStore);

  // The pool entity should be created via PoolCreated event from the PoolFactory contract
  if (currentLiquidityPool) {
    // Get the tokens from the loader and update their pricing
    let token0Instance = context.LiquidityPool.getToken0(currentLiquidityPool);

    let token1Instance = context.LiquidityPool.getToken1(currentLiquidityPool);

    let token0Price = currentLiquidityPool.token0Price;
    let token1Price = currentLiquidityPool.token1Price;

    // Normalize reserve amounts to 1e18
    let normalizedReserve0 = normalizeTokenAmountTo1e18(
      event.params.reserve0,
      Number(token0Instance.decimals)
    );
    let normalizedReserve1 = normalizeTokenAmountTo1e18(
      event.params.reserve1,
      Number(token1Instance.decimals)
    );

    // Calculate relative token prices
    // THIS IS WRONG depending on the pool, if its a stable pool, different formula!
    // We should only do this for volatile pools, where the calculation is true.
    // For stable pools we need to derive a price instead from the 'swap' event.
    if (normalizedReserve0 != 0n && normalizedReserve1 != 0n) {
      token0Price = divideBase1e18(normalizedReserve1, normalizedReserve0);

      token1Price = divideBase1e18(normalizedReserve0, normalizedReserve1);
    }

    ////////////////////////// New code for pricing liquidity pools.

    let liquidityPoolNew = context.LiquidityPoolNew.get(
      event.srcAddress.toString()
    );

    let token0Address = token0Instance.id.split("-")[0];
    let token1Address = token1Instance.id.split("-")[0];

    if (PRICING_POOLS_ADDRESSES.includes(event.srcAddress.toString())) {
      // push pool address to whitelistedPoolIds
      // let latestPrice = context.LatestPrice.get(event.srcAddress.toString());
      let priceInUSD;
      // Note pools need to be volatile for this to work!!
      if (USD_TOKENS_ADDRESSES.includes(token1Address)) {
        priceInUSD = token0Price;
      } else {
        priceInUSD = token1Price;
      }

      const newLatestPriceInstance: LatestPriceEntity = {
        id: event.srcAddress.toString(),
        price: priceInUSD,
      };
      context.LatestPrice.set(newLatestPriceInstance);
    }
    let token0PricePerUSDNew = 0n;
    let token1PricePerUSDNew = 0n;
    // update the price of tokens and use this to calculate the total liquidity in USD among other things ...
    if (liquidityPoolNew) {
      // Case 0: Also need to determine if stable or volatile pool.
      // Case 1: One or more of the tokens are USD stablecoins.
      // Case 2: One or more of the tokens have been priced against USD stablecoins (WETH,OP,VELO)
      // Case 3: Both tokens are random, will have 0 total liquidity in USD.

      // Use updated price if volatile AMM otherwise use swap based price for stable pool.
      let token0PriceNew = liquidityPoolNew.isStable
        ? liquidityPoolNew.token0Price
        : token0Price;
      let token1PriceNew = liquidityPoolNew.isStable
        ? liquidityPoolNew.token1Price
        : token1Price;

      // update the price of tokens and use this to calculate the total liquidity in USD among other things ...

      // caution, every pool can adjust prices here. Sync catiously, review!
      // Check at least x amount of stable coin reserves exist before pricing.
      // Review stability of pricing alogrithm here.
      // Assuming stability of these stable coins.
      // Don't use sync to set prices unless a critical amount of normalised reserves exist.

      // We could add some logic that if the change is more than 20% in a single shot, its likely
      // a thinly traded liquidity pool and we shouldn't use it for pricing? Price of token for normal
      // coins should never drop that much that quick. Even 50%.
      if (
        USD_TOKENS_ADDRESSES.includes(token0Address) &&
        normalizedReserve0 > BigInt(5 * 10 ** 22) // require $50k USD before using pricing.
      ) {
        token0PricePerUSDNew = TEN_TO_THE_18_BI;
        token1PricePerUSDNew = token1PriceNew;
      } else if (
        USD_TOKENS_ADDRESSES.includes(token1Address) &&
        normalizedReserve1 > BigInt(5 * 10 ** 22)
      ) {
        token0PricePerUSDNew = token0PriceNew;
        token1PricePerUSDNew = TEN_TO_THE_18_BI;
      } else if (
        // We potentially don't even need this to be a whitelist ...
        // So as long as the token had suffcient liquidity against a USD pair, its fairly priced.
        // and could be used here.
        TOKENS_PRICED_IN_USD_ADDRESSES.includes(token0Address) &&
        multiplyBase1e18(normalizedReserve0, token0PricePerUSDNew) >
          BigInt(10 * 10 ** 22)
      ) {
        // Other token can be accurately priced
        token1PricePerUSDNew = multiplyBase1e18(
          token0PricePerUSDNew,
          token1PriceNew
        );
        token0PricePerUSDNew = token0Instance.pricePerUSDNew;
      } else if (
        TOKENS_PRICED_IN_USD_ADDRESSES.includes(token1Address) &&
        multiplyBase1e18(normalizedReserve1, token1PricePerUSDNew) >
          BigInt(10 * 10 ** 22)
      ) {
        // Other token can be accurately priced
        token0PricePerUSDNew = multiplyBase1e18(
          token1PricePerUSDNew,
          token0PriceNew
        );
        token1PricePerUSDNew = token1Instance.pricePerUSDNew;
      } else if (
        multiplyBase1e18(normalizedReserve0, token0PricePerUSDNew) >
        BigInt(20 * 10 ** 22) // if more than 200k liquidity for random token, then we can use the price.
      ) {
        // Other token can be accurately priced
        token1PricePerUSDNew = multiplyBase1e18(
          token0PricePerUSDNew,
          token1PriceNew
        );
        token0PricePerUSDNew = token0Instance.pricePerUSDNew;
      } else if (
        multiplyBase1e18(normalizedReserve1, token1PricePerUSDNew) >
        BigInt(20 * 10 ** 22)
      ) {
        // Other token can be accurately priced
        token0PricePerUSDNew = multiplyBase1e18(
          token1PricePerUSDNew,
          token0PriceNew
        );
        token1PricePerUSDNew = token1Instance.pricePerUSDNew;
      } else {
        // critical, if one of the cases aren't matched, it should keep
        // what price it already has for that token and not update it.
        token0PricePerUSDNew = token0Instance.pricePerUSDNew;
        token1PricePerUSDNew = token1Instance.pricePerUSDNew;
      }
      // Think about case where a token was priced because it had suffcient liquidity,
      // but its price stays constant as it never achieves suffcient liquidity again to
      // update the price. Ideally we'd want to zero price this token again at somepoint.

      let totalLiquidityUSD = 0n;
      // Only non-zero this figure if we don't have a price for both tokens(?)
      totalLiquidityUSD =
        multiplyBase1e18(normalizedReserve0, token0PricePerUSDNew) +
        multiplyBase1e18(normalizedReserve1, token1PricePerUSDNew);
      // Start with USD pools...
      // if (USD_TOKENS_ADDRESSES.includes(token0Address)) {
      //   totalLiquidityUSD =
      //     multiplyBase1e18(normalizedReserve0, TEN_TO_THE_18_BI) +
      //     multiplyBase1e18(normalizedReserve1, token1PriceNew);
      // } else if (USD_TOKENS_ADDRESSES.includes(token1Address)) {
      //   totalLiquidityUSD =
      //     multiplyBase1e18(normalizedReserve0, token0PriceNew) +
      //     multiplyBase1e18(normalizedReserve1, TEN_TO_THE_18_BI);
      // } else if (TOKENS_PRICED_IN_USD_ADDRESSES.includes(token0Address)) {
      //   // WETH, OP, VELO  etc
      //   // LOAD USD PRICE. Multiply it
      //   // totalLiquidityUSD =
      //   //   multiplyBase1e18(normalizedReserve0, token0PriceNew) +
      //   //   multiplyBase1e18(normalizedReserve1, token1PriceNew);
      // } else if (TOKENS_PRICED_IN_USD_ADDRESSES.includes(token1Address)) {
      //   // WETH, OP, VELO  etc
      //   // totalLiquidityUSD =
      //   //   multiplyBase1e18(normalizedReserve0, token0PriceNew) +
      //   //   multiplyBase1e18(normalizedReserve1, token1PriceNew);
      // }

      // Create a new instance of LiquidityPoolEntity to be updated in the DB
      const liquidityPoolInstanceNew: LiquidityPoolNewEntity = {
        ...liquidityPoolNew,
        reserve0: normalizedReserve0,
        reserve1: normalizedReserve1,
        totalLiquidityUSD: totalLiquidityUSD,
        // totalLiquidityUSD:
        //   multiplyBase1e18(normalizedReserve0, newToken0Instance.pricePerUSD) +
        //   multiplyBase1e18(normalizedReserve1, newToken1Instance.pricePerUSD),
        // The essence here is to only update relative token pricing IF its a volatile pool,
        // Which means we can reliably use the ratio of reserves to derive a "price"
        token0Price: token0PriceNew,
        token1Price: token1PriceNew,
        lastUpdatedTimestamp: BigInt(event.blockTimestamp),
      };

      context.LiquidityPoolNew.set(liquidityPoolInstanceNew);
    }

    ///////////////////////////////////////////////////

    // Retrieve the relevant liquidity pool entities for relative pricing for each of the tokens in the pool
    // let relevantPoolEntitiesToken0 =
    //   context.LiquidityPool.whitelistedPools0.filter(
    //     (item): item is LiquidityPoolEntity => item !== undefined
    //   );
    // let relevantPoolEntitiesToken1 =
    //   context.LiquidityPool.whitelistedPools1.filter(
    //     (item): item is LiquidityPoolEntity => item !== undefined
    //   );
    let token0PricePerETH = 0n;
    let token1PricePerETH = 0n;
    // let { token0PricePerETH, token1PricePerETH } = findPricePerETH(
    //   token0Instance,
    //   token1Instance,
    //   whitelistedTokensList,
    //   trimRelevantLiquidityPoolEntities(
    //     event.srcAddress.toString(),
    //     relevantPoolEntitiesToken0
    //   ),
    //   trimRelevantLiquidityPoolEntities(
    //     event.srcAddress.toString(),
    //     relevantPoolEntitiesToken1
    //   ),
    //   event.chainId,
    //   token0Price,
    //   token1Price
    // );

    // Use relative pricing method
    // check this pricing and how accurate it is.
    // let token0PricePerUSD = multiplyBase1e18(
    //   token0PricePerETH,
    //   latestEthPrice.price
    // );
    // let token1PricePerUSD = multiplyBase1e18(
    //   token1PricePerETH,
    //   latestEthPrice.price
    // );
    let token0PricePerUSD = 0n;
    let token1PricePerUSD = 0n;

    // Create a new instance of TokenEntity to be updated in the DB
    const newToken0Instance: TokenEntity = {
      ...token0Instance,
      chainID: BigInt(event.chainId),
      pricePerETH: token0PricePerETH,
      pricePerUSD: token0PricePerUSD,
      pricePerUSDNew: token0PricePerUSDNew,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };
    const newToken1Instance: TokenEntity = {
      ...token1Instance,
      chainID: BigInt(event.chainId),
      pricePerETH: token1PricePerETH,
      pricePerUSD: token1PricePerUSD,
      pricePerUSDNew: token1PricePerUSDNew,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };

    // Create a new instance of LiquidityPoolEntity to be updated in the DB
    const liquidityPoolInstance: LiquidityPoolEntity = {
      ...currentLiquidityPool,
      reserve0: normalizedReserve0,
      reserve1: normalizedReserve1,
      totalLiquidityETH:
        multiplyBase1e18(normalizedReserve0, newToken0Instance.pricePerETH) +
        multiplyBase1e18(normalizedReserve1, newToken1Instance.pricePerETH),
      totalLiquidityUSD:
        multiplyBase1e18(normalizedReserve0, newToken0Instance.pricePerUSD) +
        multiplyBase1e18(normalizedReserve1, newToken1Instance.pricePerUSD),
      token0Price,
      token1Price,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };

    // Create a new instance of LiquidityPoolHourlySnapshotEntity to be updated in the DB
    const liquidityPoolHourlySnapshotInstance =
      getLiquidityPoolSnapshotByInterval(
        liquidityPoolInstance,
        SnapshotInterval.Hourly
      );

    // Create a new instance of LiquidityPoolDailySnapshotEntity to be updated in the DB
    const liquidityPoolDailySnapshotInstance =
      getLiquidityPoolSnapshotByInterval(
        liquidityPoolInstance,
        SnapshotInterval.Daily
      );

    // Create a new instance of LiquidityPoolWeeklySnapshotEntity to be updated in the DB
    const liquidityPoolWeeklySnapshotInstance =
      getLiquidityPoolSnapshotByInterval(
        liquidityPoolInstance,
        SnapshotInterval.Weekly
      );

    // Update the LiquidityPoolEntity in the DB
    context.LiquidityPool.set(liquidityPoolInstance);
    // Update the LiquidityPoolDailySnapshotEntity in the DB
    context.LiquidityPoolHourlySnapshot.set(
      liquidityPoolHourlySnapshotInstance
    );
    // Update the LiquidityPoolDailySnapshotEntity in the DB
    context.LiquidityPoolDailySnapshot.set(liquidityPoolDailySnapshotInstance);
    // Update the LiquidityPoolWeeklySnapshotEntity in the DB
    context.LiquidityPoolWeeklySnapshot.set(
      liquidityPoolWeeklySnapshotInstance
    );

    // Updating the Token related entities in DB for token0 and token1
    for (let tokenInstance of [newToken0Instance, newToken1Instance]) {
      // Create a new instance of LiquidityPoolHourlySnapshotEntity to be updated in the DB
      const tokenHourlySnapshotInstance = getTokenSnapshotByInterval(
        tokenInstance,
        SnapshotInterval.Hourly
      );

      // Create a new instance of LiquidityPoolDailySnapshotEntity to be updated in the DB
      const tokenDailySnapshotInstance = getTokenSnapshotByInterval(
        tokenInstance,
        SnapshotInterval.Daily
      );

      // Create a new instance of LiquidityPoolWeeklySnapshotEntity to be updated in the DB
      const tokenWeeklySnapshotInstance = getTokenSnapshotByInterval(
        tokenInstance,
        SnapshotInterval.Weekly
      );

      // Update TokenEntity in the DB
      context.Token.set(tokenInstance);
      // Update the TokenDailySnapshotEntity in the DB
      context.TokenHourlySnapshot.set(tokenHourlySnapshotInstance);
      // Update the TokenDailySnapshotEntity in the DB
      context.TokenDailySnapshot.set(tokenDailySnapshotInstance);
      // Update the TokenWeeklySnapshotEntity in the DB
      context.TokenWeeklySnapshot.set(tokenWeeklySnapshotInstance);
    }

    // we only use the WETH/USDC pool to update the ETH price
    // TODO: potentially do this calculation at the top if we want fresh eth price. Figure this out.
    // if (
    //   event.srcAddress.toString().toLowerCase() ==
    //   CHAIN_CONSTANTS[10].stablecoinPoolAddresses[0].toLowerCase()
    // ) {
    //   let ethPriceInUSD = token0Price; // given this is the weth/usdc pool, token0price is the eth price

    //   // Use the previous eth price if the new eth price is 0
    //   if (ethPriceInUSD == 0n) {
    //     ethPriceInUSD = latestEthPrice.price;
    //   }
    //   // todo: investigate why eth price seems like its constant for 1 day then changes (likely price fetcher contract)

    //   // Creating LatestETHPriceEntity with the latest price
    //   let latestEthPriceInstance: LatestETHPriceEntity = {
    //     id: event.blockTimestamp.toString(),
    //     price: ethPriceInUSD,
    //   };

    //   // Creating a new instance of LatestETHPriceEntity to be updated in the DB
    //   context.LatestETHPrice.set(latestEthPriceInstance);

    //   // update latestETHPriceKey value with event.blockTimestamp.toString()
    //   context.StateStore.set({
    //     ...stateStore,
    //     latestEthPrice: latestEthPriceInstance.id,
    //   });
    // }
  }
});

VoterContract_GaugeCreated_loader(({ event, context }) => {
  // // Dynamically register bribe VotingReward contracts
  // // This means that user does not need to manually define all the BribeVotingReward contract address in the configuration file
  // context.contractRegistration.addVotingReward(event.params.bribeVotingReward);
});

VoterContract_GaugeCreated_handler(({ event, context }) => {
  // The pool entity should be created via PoolCreated event from the PoolFactory contract
  // Store pool details in poolRewardAddressStore
  let currentPoolRewardAddressMapping = {
    poolAddress: event.params.pool,
    gaugeAddress: event.params.gauge,
    bribeVotingRewardAddress: event.params.bribeVotingReward,
    // feeVotingRewardAddress: event.params.feeVotingReward, // currently not used
  };

  addRewardAddressDetails(event.chainId, currentPoolRewardAddressMapping);
});

VoterContract_DistributeReward_loader(({ event, context }) => {
  // retrieve the pool address from the gauge address
  let poolAddress = getPoolAddressByGaugeAddress(
    event.chainId,
    event.params.gauge
  );

  // If there is a pool address with the particular gauge address, load the pool
  if (poolAddress) {
    // Load the LiquidityPool entity to be updated,
    context.LiquidityPool.emissionSinglePoolLoad(poolAddress, {});

    // Load the reward token (VELO for Optimism and AERO for Base) for conversion of emissions amount into USD
    context.Token.emissionRewardTokenLoad(
      CHAIN_CONSTANTS[event.chainId].rewardToken.address +
        "-" +
        event.chainId.toString()
    );
  } else {
    // If there is no pool address with the particular gauge address, log the error
    context.log.warn(
      `No pool address found for the gauge address ${event.params.gauge.toString()}`
    );
  }
});

VoterContract_DistributeReward_handler(({ event, context }) => {
  // Fetch reward token (VELO for Optimism and AERO for Base) entity
  let rewardToken = context.Token.emissionRewardToken;
  // Fetch the Gauge entity that was loaded
  let currentLiquidityPool = context.LiquidityPool.emissionSinglePool;

  // Dev note: Assumption here is that the GaugeCreated event has already been indexed and the Gauge entity has been created
  // Dev note: Assumption here is that the reward token (VELO for Optimism and AERO for Base) entity has already been created at this point
  if (currentLiquidityPool && rewardToken) {
    let normalizedEmissionsAmount = normalizeTokenAmountTo1e18(
      event.params.amount,
      Number(rewardToken.decimals)
    );

    // If the reward token does not have a price in USD, log
    if (rewardToken.pricePerUSD == 0n) {
      context.log.warn(
        `Reward token with ID ${rewardToken.id.toString()} does not have a USD price yet.`
      );
    }

    let normalizedEmissionsAmountUsd = multiplyBase1e18(
      normalizedEmissionsAmount,
      rewardToken.pricePerUSD
    );
    // Create a new instance of GaugeEntity to be updated in the DB
    let newLiquidityPoolInstance: LiquidityPoolEntity = {
      ...currentLiquidityPool,
      totalEmissions:
        currentLiquidityPool.totalEmissions + normalizedEmissionsAmount,
      totalEmissionsUSD:
        currentLiquidityPool.totalEmissionsUSD + normalizedEmissionsAmountUsd,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };

    // Update the LiquidityPoolEntity in the DB
    context.LiquidityPool.set(newLiquidityPoolInstance);

    // Update the RewardTokenEntity in the DB
    context.RewardToken.set(rewardToken);
  } else {
    // If there is no pool entity with the particular gauge address, log the error
    context.log.warn(
      `No pool entity or reward token found for the gauge address ${event.params.gauge.toString()}`
    );
  }
});

VotingRewardContract_NotifyReward_loader(({ event, context }) => {
  // retrieve the pool address from the gauge address
  let poolAddress = getPoolAddressByBribeVotingRewardAddress(
    event.chainId,
    event.srcAddress
  );

  if (poolAddress) {
    // Load the LiquidityPool entity to be updated,
    context.LiquidityPool.bribeSinglePoolLoad(poolAddress, {});

    // Load the reward token (VELO for Optimism and AERO for Base) for conversion of emissions amount into USD
    context.Token.bribeRewardTokenLoad(
      event.params.reward + "-" + event.chainId.toString()
    );
  } else {
    //// QUESTION - I am running into this warning quite often. What does it mean? Why would this warning happen?

    // If there is no pool address with the particular gauge address, log the error
    context.log.warn(
      `No pool address found for the bribe voting address ${event.srcAddress.toString()}`
    );
  }
});

VotingRewardContract_NotifyReward_handler(({ event, context }) => {
  // Fetch reward token (VELO for Optimism and AERO for Base) entity
  let rewardToken = context.Token.bribeRewardToken;
  // Fetch the Gauge entity that was loaded
  let currentLiquidityPool = context.LiquidityPool.bribeSinglePool;

  // Dev note: Assumption here is that the GaugeCreated event has already been indexed and the Gauge entity has been created
  // Dev note: Assumption here is that the reward token (VELO for Optimism and AERO for Base) entity has already been created at this point
  if (currentLiquidityPool && rewardToken) {
    let normalizedBribesAmount = normalizeTokenAmountTo1e18(
      event.params.amount,
      Number(rewardToken.decimals)
    );

    // If the reward token does not have a price in USD, log
    if (rewardToken.pricePerUSD == 0n) {
      context.log.warn(
        `Reward token with ID ${event.params.reward.toString()} does not have a USD price yet.`
      );
    }

    // Calculate the bribes amount in USD
    let normalizedBribesAmountUsd = multiplyBase1e18(
      normalizedBribesAmount,
      rewardToken.pricePerUSD
    );
    // Create a new instance of GaugeEntity to be updated in the DB
    let newLiquidityPoolInstance: LiquidityPoolEntity = {
      ...currentLiquidityPool,
      totalBribesUSD:
        currentLiquidityPool.totalBribesUSD + normalizedBribesAmountUsd,
      lastUpdatedTimestamp: BigInt(event.blockTimestamp),
    };

    // Update the LiquidityPoolEntity in the DB
    context.LiquidityPool.set(newLiquidityPoolInstance);

    // Update the RewardTokenEntity in the DB
    context.RewardToken.set(rewardToken);
  }
});
