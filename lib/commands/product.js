// @ts-check
import {
    createProduct,
    deleteProduct,
    deleteProductProperty,
    getProduct,
    getProductApi,
    getProductProperties,
    getProductProperty,
    getProducts,
    productExists,
    setProductProperty,
} from '../product.js';
import { runPool } from '../concurrency.js';
import { alreadyExistsError } from '../errors.js';
import { hint, info, label, success } from '../format.js';
import { classifyError, createSpinner, isJsonMode, printErr, printOk } from '../output.js';
import {
    applyJsonFlag,
    confirmDestructive,
    ensureConfigured,
    getGlobalUser,
    parseJsonValue,
    parsePositiveInt,
    readJsonArgument,
    runCommand,
} from './_shared.js';

/**
 * `<cli> product <action> <productId> …` — products and their
 * product-level properties.
 */
export function registerProductCommands(program) {
    const product = program
        .command('product')
        .helpGroup('Operations:')
        .description('Products: list, inspect, create, delete and product properties');

    product
        .command('list')
        .helpGroup('Discovery:')
        .description('List every product configured on the account')
        .option('-j, --json', 'Output as JSON')
        .option(
            '-c, --concurrency <n>',
            'Max parallel API-resource lookups (default: 10)',
            parsePositiveInt('concurrency'),
            10,
        )
        .action(async (opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);

            const spinner = createSpinner('Fetching products...').start();
            let products;
            try {
                products = await getProducts(user);
            } catch (error) {
                spinner.fail('Failed to fetch products');
                const { message, code } = classifyError(error);
                printErr(message, { code });
                return;
            }

            // API-resource counts come from each product's profile.
            // Parallelise so a large catalogue doesn't crawl serially.
            const apiResults = await runPool(products, opts.concurrency, async (p) => {
                const apis = await getProductApi(p.product, user);
                return Object.keys(apis || {}).length;
            });
            const rows = products.map((p, i) => ({
                product: p.product,
                name: p.name && p.name !== p.product ? p.name : null,
                enabled: !!p.enabled,
                api_resources: apiResults[i]?.ok ? apiResults[i].value : null,
            }));

            spinner.succeed(`Found ${rows.length} product(s)`);

            if (isJsonMode()) {
                printOk({ products: rows });
                return;
            }

            const idWidth = rows.reduce((w, r) => Math.max(w, String(r.product ?? '').length), 0);
            for (const r of rows) {
                const flag = r.enabled ? success('enabled ') : hint('disabled');
                const id = label(String(r.product ?? '(no id)').padEnd(idWidth));
                const name = r.name ? hint(`(${r.name})`) : '';
                const apis = r.api_resources ? hint(`${r.api_resources} API resource(s)`) : '';
                const extras = [name, apis].filter(Boolean).join('  ');
                console.log(`  ${flag}  ${id}${extras ? '  ' + extras : ''}`);
            }
        });

    product
        .command('info <productId>')
        .helpGroup('Discovery:')
        .description('Print the full product document (config and profile) as JSON')
        .option('-j, --json', 'Output as JSON envelope')
        .action(async (productId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            await runCommand({
                start: `Fetching ${productId}...`,
                fn: () => getProduct(productId, user),
                success: null,
                failure: 'Failed to read product',
                onSuccess: (doc) => {
                    if (isJsonMode()) printOk(doc);
                    else console.log(JSON.stringify(doc, null, 2));
                },
            });
        });

    product
        .command('create <productId>')
        .helpGroup('Records:')
        .description('Create a product, bare or from a JSON document (config + profile)')
        .option('-n, --name <name>', 'Display name')
        .option('-d, --description <text>', 'Description')
        .option('--from <file>', 'JSON document with `config` and/or `profile` ("-" for stdin)')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            await runCommand({
                start: `Creating ${productId}...`,
                fn: async () => {
                    if (await productExists(productId, user)) {
                        throw alreadyExistsError(`Product "${productId}" already exists`);
                    }
                    const doc = opts.from ? await readJsonArgument(opts.from) : {};
                    await createProduct(productId, user, {
                        name: opts.name || doc.name,
                        description: opts.description || doc.description,
                        enabled: doc.enabled ?? true,
                        config: doc.config,
                        profile: doc.profile,
                    });
                },
                success: `Created product ${productId}`,
                failure: 'Failed to create product',
                onSuccess: () => {
                    if (isJsonMode()) printOk({ product: productId });
                },
            });
        });

    product
        .command('delete <productId>')
        .helpGroup('Records:')
        .description('Delete a product (its devices stay, unassigned)')
        .option('-y, --yes', 'Skip the interactive confirmation prompt')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            if (
                !(await confirmDestructive(
                    opts,
                    `Delete product ${productId}? This cannot be undone.`,
                ))
            ) {
                console.log(hint('Cancelled.'));
                return;
            }
            try {
                const removed = await deleteProduct(productId, user);
                if (isJsonMode()) {
                    printOk({ product: productId, removed });
                    return;
                }
                console.log(
                    removed
                        ? `Deleted ${info(productId)}`
                        : `Product ${info(productId)} did not exist`,
                );
            } catch (error) {
                const { message, code } = classifyError(error);
                printErr(message, { code });
            }
        });

    product
        .command('property-list <productId>')
        .helpGroup('Product properties:')
        .description('List the names of the properties attached to a product')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            await runCommand({
                start: `Getting properties of ${productId}...`,
                fn: () => getProductProperties(productId, user),
                success: null,
                failure: 'Property retrieval failed',
                onSuccess: (list) => {
                    const names = Array.isArray(list)
                        ? list.map((p) => p.property).filter(Boolean)
                        : [];
                    if (isJsonMode()) {
                        printOk({ product: productId, properties: names });
                        return;
                    }
                    if (!names.length) {
                        console.log(`No properties on product ${info(productId)}`);
                        return;
                    }
                    console.log(`Properties of product ${info(productId)}:`);
                    for (const n of names) console.log(`- ${n}`);
                },
            });
        });

    product
        .command('property-get <productId> <propertyId>')
        .helpGroup('Product properties:')
        .description('Read a property attached to a product')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, propertyId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            await runCommand({
                start: `Reading ${propertyId}...`,
                fn: () => getProductProperty(productId, propertyId, user),
                success: null,
                failure: 'Property retrieval failed',
                onSuccess: (value) => {
                    if (isJsonMode()) printOk({ product: productId, property: propertyId, value });
                    else console.log(JSON.stringify(value, null, 2));
                },
            });
        });

    product
        .command('property-set <productId> <propertyId> <value>')
        .helpGroup('Product properties:')
        .description('Create or overwrite a product property (value parsed as JSON)')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, propertyId, value, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            const parsed = parseJsonValue(value);
            await runCommand({
                start: `Saving ${propertyId} on ${productId}...`,
                fn: () => setProductProperty(productId, propertyId, parsed, user),
                success: `Saved ${propertyId} on ${productId}`,
                failure: 'Failed to save property',
                onSuccess: () => {
                    if (isJsonMode())
                        printOk({ product: productId, property: propertyId, value: parsed });
                },
            });
        });

    product
        .command('property-delete <productId> <propertyId>')
        .helpGroup('Product properties:')
        .description('Delete a product property (idempotent)')
        .option('-j, --json', 'Output as JSON')
        .action(async (productId, propertyId, opts, cmd) => {
            applyJsonFlag(opts);
            ensureConfigured();
            const user = getGlobalUser(cmd);
            await runCommand({
                start: `Deleting ${propertyId}...`,
                fn: () => deleteProductProperty(productId, propertyId, user),
                success: null,
                failure: 'Failed to delete property',
                onSuccess: (removed) => {
                    if (isJsonMode()) {
                        printOk({ product: productId, property: propertyId, removed });
                        return;
                    }
                    console.log(
                        removed
                            ? `Deleted ${info(propertyId)} from ${info(productId)}`
                            : `Property ${info(propertyId)} was not set on ${info(productId)}`,
                    );
                },
            });
        });

    return product;
}
